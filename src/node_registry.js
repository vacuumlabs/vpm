import csp from 'js-csp'
const semverCmp = require('semver-compare')
const mkdirp = require('mkdirp')
const fs = require('fs')
const rimraf = require('rimraf')
import {satisfies, rcompare} from 'semver'
import {map, filter, seq} from 'transducers.js'
import {set, get, sample, random, isEmpty} from 'lodash'
import {cspAll, cspy, cspStat} from './lib/csp_utils'
import {getIn} from './lib/state_utils'
import {getPackageInfo} from './pkg_registry'
import {extractTarballDownload} from 'tarball-extract'

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
    // TODO continue here
    //yield node.resolveVersion()
    set(nodeRegistry, ['__root__', node.version], node)
    yield node.resolveDependencies()
    return node
  })
}

// finds existing node that fits semver range, or creates a new one
// option to ignore dependencies only for testing
export function resolveNode(name, semver = '*', testIgnoreDeps = false) {
  return csp.go(function*() {
    let nr = get(nodeRegistry, name) || get(set(nodeRegistry, name, {}), name)
    // try to match versions
    for (let version in nr) {
      if (satisfies(version, semver)) {
        return nr[version]
      }
    }
    let node = nodeFactory(name)
    yield node.resolveVersion()
    set(nodeRegistry, [name, node.version], node)
    testIgnoreDeps || (yield node.resolveDependencies())
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

export function nodeFactory(name) {

  let self

  //const versionPubFilter = filter(d => d[Symbol.for('public')])
  //const depPubFilter = map(d => seq(d, versionPubFilter))

  function depFilterForSymbol(symName) {
    const innerFilter = filter(d => d[Symbol.for(symName)])
    return map(d => seq(d, innerFilter))
  }

  // gets package.json format of dependencies, with symbol for public where needed
  // package downloaded from npm-registry contains all versions
  // one downloaded from github / root package has dependencies directly on itself
  // TODO move registryPkg to self, set it based on parsed dependency
  function getDeps(type, registryPkg = true) {
    return csp.go(function*() {
      let ver
      if (registryPkg) {
        ver = getIn(
          yield self.getPkg(),
          ['versions', self.version],
        )
      } else {
        ver = yield self.getPkg()
      }
      let deps = getIn(ver, [type], {last: {}})
      if (type === 'peerDependencies' || type === 'publicDependencies') {
        // public deps - mark them as such
        // use symbol so that we don't mix the public flag with versions
        Object.keys(deps).forEach(k => deps[k][Symbol.for('public')] = true)
      }
      return deps
    })
  }

  // TODO move registryPkg to self, set it based on parsed dependency
  function getTarballUrl(registryPkg = true) {
    return csp.go(function*() {
      let tarball
      if (registryPkg) {
        // sometimes, the tarball link is stored under 'dist' key, bundled with shasum
        tarball = getIn(
          yield self.getPkg(),
          ['versions', self.version, 'tarball'],
          {
            last: getIn(
              yield self.getPkg(),
              ['versions', self.version, 'dist', 'tarball']
            )
          }
        )
      } else {
        tarball = getIn(yield self.getPkg(), ['tarball'])
      }
      console.log('========================================')
      console.log(tarball)
      return tarball
    })
  }

  //check if semver is equal to any of versions (also semvers)
  function semverExists(semver, versions) {
    for (let ver of versions) {
      if (semverCmp(semver,ver) === 0) return ver
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
    isRoot: name === '__root__', // ugly, redo / remove ?
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

    resolveVersion: (semver = '*') => {
      return csp.go(function*() {
        console.assert(self.status === 'init', 'Version should be resolved right after node initialization.')
        self.status = 'version-start'
        self.version =
          (yield self.getPkg()).version ||
          filter(Object.keys((yield self.getPkg()).versions).sort(rcompare), v => satisfies(v, semver))[0]
        console.assert(self.version !== undefined, 'No version satisfies requirements') // TODO return false and handle
        self.status = 'version-done'
      })
    },

    // TODO check if already resolved?
    resolveDependencies: () => {
      return csp.go(function*() {
        console.assert(self.status === 'version-done', 'Dependencies should be resolved right after version')
        self.status = 'private-dependencies-start'
        // installing devDeps only for root package
        // we assume no overlap in private/public/peer deps, otherwise public > peer > dev > private
        const deps = Object.assign(yield getDeps('dependencies'), (self.name === '__root__') ? yield getDeps('devDependencies') : {}, yield getDeps('peerDependencies'), yield getDeps('publicDependencies'))
        const dependencyNodes = yield cspAll(map(Object.keys(deps), pkgName => resolveNode(pkgName, deps[pkgName])))
        for (let dn of dependencyNodes) {
          linkNodes(self, dn, deps[dn.name], deps[Symbol.for('public')])
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
      const prevNames = new Set(Object.keys(self.checkedDependencies.passedDeps).concat(Object.keys(self.checkedDependencies.conflictingDeps)))
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
              self.checkedDependencies.passedDeps[name] = undefined
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
        }
        yield cspy(mkdirp, `${rootPath}/tmp_modules`)
        yield cspy(mkdirp, `${rootPath}/node_modules/vpm_modules`)
        let targetUrl = yield getTarballUrl()
        let tempDir = Math.random().toString(36).substring(8)
        let tempPath = `${rootPath}/tmp_modules/${self.name}${self.version}${tempDir}`
        let targetPath = `${rootPath}/node_modules/vpm_modules/${self.name}${self.version}`
        let ret = yield cspy(
          extractTarballDownload,
          targetUrl,
          `${rootPath}/tmp_modules/${targetUrl.split('/').pop()}`,
          tempPath,
          {}
        )
        if (ret !== csp.CLOSED) {
          console.log(`Error while installing ${self.name}${self.version}`)
          console.log(ret)
          return ret
        }
        // tar may have it's content in 'package' subdirectory
        // TODO error handling ? TODO subdirectory might not be named 'package'
        if ((yield cspStat(`${tempPath}/package`)).isDirectory) {
          yield cspy(fs.rename, `${tempPath}/package`, targetPath)
          yield cspy(rimraf, tempPath)
        } else {
          yield cspy(fs.rename, tempPath, targetPath)
        }
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
      if (!self.checkDependencies()) conflictingNodes.push(self)
      flattenDependencies(self.dependencies).forEach(d => d.resolvedIn.crawlAndCheck(updateToken))
    },

    crawlAndPrint: (updateToken = Symbol(), offset = 0) => {
      if (self.checkToken === updateToken) return
      console.log(`${' '.repeat(offset)}${self.name}`)
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
