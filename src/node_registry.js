import csp from 'js-csp'
const semverCmp = require('semver-compare')
const mkdirp = require('mkdirp')
const fs = require('fs')
const rimraf = require('rimraf')
import {satisfies, rcompare, validRange as semverValid} from 'semver'
import {map, filter, seq} from 'transducers.js'
import {set, sample, random, isEmpty, clone} from 'lodash'
import {cspAll, cspy, cspStat, cspParseFile, installUrl} from './lib/csp_utils'
import {getIn, serialGetIn} from './lib/state_utils'
import {getPackageInfo} from './pkg_registry'
import {isUri} from 'valid-url'

/* -- comment section --

nodeRegistry = {
  name => {
    version => {
      dependent: [{
        node: node,
        semver: semver
      }],
      nodeChannel: ch
      subscribe:
    }
  }
}

depSet = {
  name => {
    version => {
      dependencyObject
    }
  }
}

-- end comment section -- */

const getter = getPackageInfo()

let nodeRegistry = {}
let conflictingNodes = []

//for testing
export function resetRegistry() {
  nodeRegistry = {}
  conflictingNodes = []
}

export function getConflictingNodes() {
  return conflictingNodes
}

// checks and repairs subtree starting at root
// despite original intent, root must be tree root, otherwise it might break
export function mutateIntoConsistent(root) {
  conflictingNodes = []
  root.crawlAndCheck()
  while (conflictingNodes.length) {
    console.log('New mutation round')
    //choose random conflicting
    let node = sample(conflictingNodes)
    // TODO annealing - go further up with higher temp, go rand(0..4) for now
    let depth = random(4)
    for (let i = 0; i < depth; i++) {
      //abort if we can't go higher
      if (isEmpty(node.subscribers)) break
      node = sample(sample(node.subscribers)).resolvedIn
      node.mutate()
      root.crawlAndCollectSuccessorDeps
    }
    conflictingNodes = []
    root.crawlAndCheck()
  }
}

// expects package.json in root path
export function resolveRootNode(rootPath) {
  return csp.go(function*() {
    let node = nodeFactory('__root__')
    yield node.resolvePackage(`${rootPath}/package.json`)
    set(nodeRegistry, ['__root__', node.version], node)
    yield node.resolveDependencies()
    node.crawlAndCollectSuccessorDeps()
    return node
  })
}

// finds existing node that fits semver range, or creates a new one
// option to ignore dependencies only for testing
export function resolveNode(name, semverOrUrl = '*') {
  return csp.go(function*() {
    let nr = getIn(nodeRegistry, [name], {any: false}) || (nodeRegistry[name] = {})
    // for now create only 'local' node without adding it to registry
    let node = nodeFactory(name)
    // resolve highest available version
    yield node.resolvePackage(semverOrUrl)
    //try to get already satisfying version (new packages might have been added during yield)
    for (let version in nr) {
      if (satisfies(version, semverOrUrl)) {
        return nr[version]
      }
    }
    console.log(`${name}${semverOrUrl} resolved into new version ${node.version} not matched in [${Object.keys(nr)}]`)
    nodeRegistry[name][node.version] = node
    yield node.resolveDependencies()
    node.crawlAndCollectSuccessorDeps()
    return node
  })
}

function removeFromDepSet(depSet, nodeObj) {
  for (let dep in depSet) {
    for (let version in depSet[dep]) {
      if (depSet[dep][version].resolvedIn === nodeObj) {
        if (Object.keys(depSet[dep]).length === 1) {
          // was the only version, remove whole dependency
          delete depSet[dep]
        } else {
          // only delete single version
          delete depSet[dep][version]
        }
      }
    }
  }
}

// create dependency and assign both ways
// semver, parent, public
function linkNodes(parent, child, semver, pub) {
  let dep = dependency(semver, child, pub)
  parent.addDependency(parent.dependencies, dep)
  child.addDependency(child.subscribers, dep)
}

// remove from both dependencies and subscribers
function unlinkNodes(parent, child) {
  removeFromDepSet(parent.dependencies, child)
  removeFromDepSet(child.subscribers, parent)
}

// factory
// 'one way' (stores only the 'child' of dep. assocation) so that it can be exported
// and bubble up along the hierarchy
function dependency(semver, node, pub) {
  return {
    name: node.name,
    semver: semver,
    public: pub,
    resolvedIn: node
  }
}

// package as an alternative to the one from npm registry
// directTarballUrl for packages refenrenced by it - TODO
// used for root node and for testing
export function nodeFactory(name) {

  let self

  //const versionPubFilter = filter(d => d[Symbol.for('public')])
  //const depPubFilter = map(d => seq(d, versionPubFilter))

  function depFilterForSymbol(symName) {
    const innerFilter = filter(d => d[Symbol.for(symName)])
    return map(d => seq(d, innerFilter))
  }

  // gets package.json format of dependencies, with symbol for public where needed
  function getDeps(type) {
    return csp.go(function*() {
      // package downloaded from npm-registry contains all versions
      // one downloaded from github / root package has dependencies directly on itself
      let regitryPkgDeps = getIn(
        yield self.getPkg(),
        ['versions', self.version, type],
        {any: {}}
      )
      let directPkgDeps = getIn(
        yield self.getPkg(),
        [type],
        {any: {}}
      )
      let deps = Object.assign({}, regitryPkgDeps, directPkgDeps)
      Object.keys(deps).forEach(k => {
        if (semverValid(deps[k])) {
          deps[k] = {semver: deps[k]}
        } else if (isUri(deps[k])) {
          deps[k] = {url: deps[k]}
        } else {
          throw new Error(`Invalid dependency value ${deps[k]} - currently only semver or link to archive are supported`)
        }
      })
      if (type === 'peerDependencies' || type === 'publicDependencies') {
        // public deps - mark them as such
        // use symbol so that we don't mix the public flag with versions
        Object.keys(deps).forEach(k => {
          deps[k][Symbol.for('public')] = true
          console.log(`PUBLIC >> ${k}`)
        })
      }
      return deps
    })
  }

  function getTarballUrl() {
    return csp.go(function*() {
      let pkg = yield self.getPkg()
      // sometimes, the tarball link is stored under 'dist' key, bundled with shasum
      let tarball = serialGetIn(pkg,
        [
          ['tarball'],
          ['versions', self.version, 'tarball'],
          ['versions', self.version, 'dist', 'tarball']
        ]
      )
      return tarball
    })
  }

  //check if semver is equal to any of versions (also semvers)
  function semverExists(semver, versions) {
    for (let ver of versions) {
      if (semverCmp(semver, ver) === 0) return ver
    }
    return undefined
  }

  // returns an array of dependency objects
  function flattenDependencies(depSet) {
    const ret = []
    for (let dep in depSet) {
      for (let version in depSet[dep]) {
        ret.push(depSet[dep][version])
      }
    }
    return ret
  }

  // creates a shallow copy of each dependency in the set
  function copyDependencies(depSet, removePublicFlag) {
    const ret = {}
    for (let dep in depSet) {
      ret[dep] = {}
      for (let version in dep) {
        ret[dep][version] = depSet[dep][version]
        ret[dep][version][Symbol.for('public')] = removePublicFlag ? undefined : ret[dep][version][Symbol.for('public')]
      }
    }
    return ret
  }

  self = {
    name: name,
    version: undefined,
    status: 'init', // never really used, remove
    installPath: undefined,
    subscribers: {},
    checkToken: Symbol(),
    successorToken: Symbol(),
    dependencies: {},
    successorDependencies: {},
    checkedDependencies: {
      passedDeps: {},
      conflictingDeps: {}
    },
    getPkg: getter.bind(null, name),

    test: () => {
      return csp.go(function*() {
        for (let i = 0; i < 5; i++) {
          (yield self.getPkg()).name
        }
      })
    },

    addDependency: (depSet, dependency) => {
      depSet[dependency.name] = depSet[dependency.name] || {}
      const existingSemver = semverExists(dependency.semver, Object.keys(depSet[dependency.name]))
      if (existingSemver === undefined) {
        depSet[dependency.name][dependency.semver] = dependency
      } else if (dependency[Symbol.for('public')]) {
        // public deps have higher prority
        depSet[dependency.name][existingSemver] = dependency
      }
    },

    resolvePackage: (semverOrUrl = '*') => {
      return csp.go(function*() {
        console.assert(self.status === 'init', 'Version should be resolved right after node initialization.')
        self.status = 'package-start'
        if (self.name === '__root__') {
          let pkg = JSON.parse(yield cspParseFile(semverOrUrl))
          if (isEmpty(pkg)) {
            throw new Error(`package.json not found in ${semverOrUrl}`)
          }
          self.version = pkg.version || '0.0.0'
          self.getPkg = () => pkg
          self.status = 'package-done'
          return
        }
        self.getPkg = isUri(semverOrUrl) ? getter.bind(null, semverOrUrl) : self.getPkg
        let pkg = yield self.getPkg()
        // TODO don't just get highest, try to match ?
        self.version =
          pkg.version || filter(Object.keys(pkg.versions).sort(rcompare), v => satisfies(v, semverOrUrl))[0]
        console.assert(self.version !== undefined, 'No version satisfies requirements') // TODO return false and handle
        self.status = 'package-done'
      })
    },

    resolveDependencies: () => {
      return csp.go(function*() {
        console.assert(self.status === 'package-done', 'Dependencies should be resolved right after version')
        self.status = 'private-dependencies-start'
        // installing devDeps only for root package
        // we assume no overlap in private/public/peer deps, otherwise public > peer > dev > private
        const deps = Object.assign(yield getDeps('dependencies'), (self.name === '__root__') ? yield getDeps('devDependencies') : {}, yield getDeps('peerDependencies'), yield getDeps('publicDependencies'))
        const dependencyNodes = yield cspAll(map(Object.keys(deps), pkgName => resolveNode(pkgName, deps[pkgName].semver || deps[pkgName].url)))
        for (let dn of dependencyNodes) {
          linkNodes(self, dn, deps[dn.name].semver || dn.version, deps[dn.name][Symbol.for('public')])
        }
        self.status = 'private-dependencies-done'
      })
    },

    // merge exported dependencies of dependencies with own public deps
    // privateDep - whether we're exporting along a private branch
    // if so, remove the public flag in copyDependencies
    exportDependencies: (privateDep) => {
      const exportPubDeps = seq(self.dependencies, depFilterForSymbol('public'))
      flattenDependencies(seq(self.successorDependencies, depFilterForSymbol('public'))).forEach(
        dep => self.addDependency(exportPubDeps, dep)
      )
      return copyDependencies(exportPubDeps, privateDep)
    },

    getPredecessorDependencies: () => {
      let predecessorDeps = {}
      for (let sub of flattenDependencies(self.subscribers)) {
        flattenDependencies(sub.resolvedIn.exportDependencies()).forEach(
          d => self.addDependency(predecessorDeps, d)
        )
      }
      return predecessorDeps
    },

    checkDependencies: () => {
      self.checkedDependencies = {passedDeps: {}, conflictingDeps: {}}
      const newDeps = flattenDependencies(self.dependencies)
          .concat(flattenDependencies(self.successorDependencies))
          .concat(flattenDependencies(self.getPredecessorDependencies()))
          .map(d => clone(d))
      const prevNames = new Set() //Object.keys(self.checkedDependencies.passedDeps).concat(Object.keys(self.checkedDependencies.conflictingDeps))
      for (let name in newDeps) {
        if (prevNames.has(name)) {
          if (self.checkedDependencies.passedDeps[name] !== undefined) {
            if (self.checkedDependencies.passedDeps[name].resolvedIn !== newDeps[name].resolvedIn) {
              //sanity-check
              if (self.checkedDependencies.conflictingDeps[name] !== undefined) {
                throw new Error(`Dependency name in both checked and conflicting: ${self.checkedDependencies} , ${newDeps}`)
              }
              // new conflict, move previous dependency from passedDeps to conflicting, add new conflicting
              self.checkedDependencies.conflictingDeps[name] = []
              self.checkedDependencies.conflictingDeps[name].push(self.checkedDependencies.passedDeps[name], newDeps[name])
              self.checkedDependencies.passedDeps[name] = undefined // TODO delete key, use 'has' to check for existence
            } else {
              // merge semvers, they resolve into at least one version
              self.checkedDependencies.passedDeps[name].semver = `${self.checkedDependencies.passedDeps[name].semver} ${newDeps[name].semver}`
            }
          } else {
            // find if we can merge with any of the already conflicting ones
            for (let conflict of self.checkedDependencies.conflictingDeps) {
              if (conflict.resolvedIn === newDeps[name].resolvedIn) {
                conflict.semver = `${conflict.semver} ${newDeps[name].semver}`
                continue
              }
            }
            // no conflict resolves to same node, add new conflicting
            self.checkedDependencies.conflictingDeps[name].push(newDeps[name])
          }
        } else {
          // add non-conflicting
          self.checkedDependencies.passedDeps[name] = newDeps[name]
        }
      }
      if (self.checkedDependencies.conflictingDeps.length) return false
      return true
    },

    crawlAndCollectSuccessorDeps: (updateToken = Symbol()) => {
      if (self.successorToken === updateToken) return
      self.successorToken = updateToken
      self.successorDependencies = {}
      for (let dep of flattenDependencies(self.dependencies)) {
        // decend to the lowest child first
        dep.resolvedIn.crawlAndCollectSuccessorDeps(updateToken)
        flattenDependencies(dep.resolvedIn.exportDependencies(!dep[Symbol.for('public')])).forEach(
          d => self.addDependency(self.successorDependencies, d)
        )
      }
    },

    mutate: () => {
      return csp.go(function*() {
        let allSubscribers = flattenDependencies(self.subscribers)
        // make sure we satisfy at least one of the subscribers
        let subToReceiveMutation = sample(allSubscribers)
        let version = sample(yield self.getPkg().getAvailableMutation(self.version, subToReceiveMutation.semver))
        let newNode = resolveNode(self.name, version)
        // the one subscriber is guaranteed to receive the new node
        // for the rest, apply where possible
        for (let sub of allSubscribers) {
          if (satisfies(version, sub.semver)) {
            unlinkNodes(sub.resolvedIn, self)
            linkNodes(sub.resolvedIn, newNode, sub.semver, sub[Symbol.for('public')])
            console.log(`Mutated ${self.name}: ${self.version} -> ${newNode.version} for ${sub.resolvedIn.name}`)
          }
        }
      })
    },

    // TODO - separate download and install into different worker groups?
    // TODO - export bin files (according to documentation) to .bin as symlinks
    downloadAndInstall: (rootPath) => {
      return csp.go(function*() {
        if (self.name === '__root__') {
          self.status = 'installed'
          self.installPath = rootPath
          return
        }
        // TODO simplify installUrl args
        let targetUrl = yield getTarballUrl()
        let targetPath = `${rootPath}/node_modules/vpm_modules/${self.name}${self.version}`
        yield installUrl(targetUrl, rootPath, `/node_modules/vpm_modules`, `${self.name}${self.version}`)
        self.status = 'installed'
        self.installPath = targetPath
      })
    },

    symlink: (rootPath) => {
      return csp.go(function*() {
        let flatDeps = flattenDependencies(self.dependencies)
        if (flatDeps.length === 0) return
        yield cspy(mkdirp, `${self.installPath}/node_modules`)
        //TODO multiple versions on same level
        for (let dep of flatDeps) {
          if (typeof dep.resolvedIn.installPath !== 'string') {
            // TODO maybe look for the real problem elsewhere ? though this was probably because of tests
            console.log(`Error - ${dep.resolvedIn.name} not installed, try one more time..`)
            yield dep.resolvedIn.downloadAndInstall(rootPath)
          }
          console.log(`linking ${dep.resolvedIn.installPath} -> ${self.installPath}/node_modules/${dep.resolvedIn.name}`)
          yield cspy(
            fs.symlink,
            dep.resolvedIn.installPath,
            `${self.installPath}/node_modules/${dep.resolvedIn.name}`,
            'dir'
          )
        }
      })
    },

    crawlAndCheck: (updateToken = Symbol()) => {
      if (self.checkToken === updateToken) return
      self.checkToken = updateToken
      if (!self.checkDependencies()) {
        conflictingNodes.push(self.checkedDependencies.conflictingDeps.map(d => d.resolvedIn))
      }
      flattenDependencies(self.dependencies).forEach(d => d.resolvedIn.crawlAndCheck(updateToken))
    },

    crawlAndPrint: (updateToken = Symbol(), offset = 0) => {
      if (self.checkToken === updateToken) {
        console.log(`${' '.repeat(offset)}*${self.name} ${self.version}`)
        return
      }
      console.log(`${' '.repeat(offset)}${self.name} ${self.version}`)
      self.checkToken = updateToken
      flattenDependencies(self.dependencies).forEach(d => d.resolvedIn.crawlAndPrint(updateToken, offset+2))
    },

    // skip argument allows us to ommit root node when needed
    crawlAndFlatten: (updateToken = Symbol(), skip = false) => {
      if (self.checkToken === updateToken) return []
      let ret = skip ? [] : [self]
      self.checkToken = updateToken
      flattenDependencies(self.dependencies).forEach(d => ret = ret.concat(d.resolvedIn.crawlAndFlatten(updateToken)))
      return ret
    },
  }

  return self
}
