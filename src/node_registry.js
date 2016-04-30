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

let PUBLIC_DEP_TEST = false
const ANNEAL_ITERATIONS = 1000

export function enableTestMode(state = true) {
  PUBLIC_DEP_TEST = state
}

/* -- comment section --

nodeRegistry = {
  name => {
    version => {

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
let conflictingNodes = new Set()

//for testing
export function resetRegistry() {
  nodeRegistry = {}
  conflictingNodes = new Set()
}

export function getConflictingNodes() {
  return conflictingNodes
}

export function checkDependencies(root) {
  conflictingNodes = new Set()
  root.checkNode()
  return conflictingNodes.size
}

let debugroot

// checks and repairs subtree starting at root
// despite original intent, root must be tree root, otherwise it might break
export function mutateIntoConsistent(root) {
  return csp.go(function*() {
    //console.log('__mutate deps')
    debugroot=root
    checkDependencies(root)
    console.log(conflictingNodes)
    console.log('>>>>>>>INSIDE MUTATIONS<<<<<<<<<<<')
    while (conflictingNodes.length) {
      console.log('New mutation round')
      //choose random conflicting
      let node = sample(conflictingNodes)
      let depth = random(4)
      for (let i = 0; i < depth; i++) {
        //abort if we can't go higher
        //this shouldn't happen: if (isEmpty(node.subscribers)) break
        let nodeProposition = sample(sample(node.subscribers)).resolvedIn
        if (nodeProposition.name === '__root__') break
        node = nodeProposition
        console.log(`descend ${node.name}`)
      }
      yield node.mutate()
      //root.crawlAndCollectSuccessorDeps
      conflictingNodes = []
      checkDependencies(root)
      //root.crawlAndPrint()
    }
  })
}

function probabilisticTransition(stateOld, stateNew, temp) {
  return stateNew < stateOld
  //return ((stateNew < stateOld) || (Math.exp(-1 * (stateNew - stateOld) / temp) > Math.random()))
}

export function annealing(root) {
  return csp.go(function*() {
    //console.log('__mutate deps')
    //console.log('initial')
    //root.crawlAndPrint()
    debugroot = root
    for (let i = 0; i < ANNEAL_ITERATIONS; i++) {
      let oldState = checkDependencies(root)
      console.log(`Anneling iteration ${i} conflicts ${oldState}`)
      if (!oldState) break
      let muts = mutatibleNodes()
      //console.log(muts)
      let candidate = sample(muts)
      //console.log(candidate)
      let undoMutation = yield candidate.mutate()
      let newState = checkDependencies(root)
      //console.log('after mutation')
      //root.crawlAndPrint()
      if (!probabilisticTransition(oldState, newState, ANNEAL_ITERATIONS - i)) {
        //console.log('check failed - undoing')
        undoMutation()
        //root.crawlAndPrint()
      }
    }
  })
}

// returns the part of the tree which is worthy of mutation
function mutatibleNodes() {
  let ret = new Set()
  const recCrawl = (node) => {
    if (!flattenDependencies(node.subscribers).length) return
    ret.add(node)
    flattenDependencies(node.subscribers).forEach(s => {
      if (!ret.has(s.resolvedIn)) recCrawl(s.resolvedIn)
    })
  }
  Array.from(conflictingNodes).forEach(n => recCrawl(n))
  return Array.from(ret)
}

// expects package.json in root path
export function resolveRootNode(rootPath) {
  PUBLIC_DEP_TEST && console.log(`TEST MODE ON - ALL DEPENDENCIES PUBIC`)
  return csp.go(function*() {
    let node = nodeFactory('__root__')
    yield node.resolvePackage(`${rootPath}/package.json`)
    set(nodeRegistry, ['__root__', node.version], node)
    yield node.resolveDependencies()
    //node.crawlAndCollectSuccessorDeps()
    return node
  })
}

// finds existing node that fits semver range, or creates a new one
// option to ignore dependencies only for testing
export function resolveNode(name, semverOrUrl = '*') {
  return csp.go(function*() {
    //console.log('__resolve node')
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
    //node.crawlAndCollectSuccessorDeps()
    return node
  })
}

function removeFromDepSet(depSet, nodeObj) {
  //console.log('__remove deps')
  for (let dep in depSet) {
    for (let version in depSet[dep]) {
      if (depSet[dep][version].resolvedIn === nodeObj) {
        if (Object.keys(depSet[dep]).length === 1) {
          // was the only version, remove whole dependency
          //console.log(`deleted ${dep} from ${depSet}`)
          delete depSet[dep]
        } else {
          // only delete single version
          delete depSet[dep][version]
        }
      }
    }
  }
}

// returns an array of dependency objects
function flattenDependencies(depSet) {
  //console.log('__flatten deps')
  const ret = []
  for (let dep in depSet) {
    for (let version in depSet[dep]) {
      //console.log(`${dep} ${version}`)
      ret.push(depSet[dep][version])
    }
  }
  return ret
}

// create dependency and assign both ways
// semver, parent, public
function linkNodes(parent, child, semver, pub, debug) {
  //console.log('__link')
  parent.addDependency(parent.dependencies, dependency(semver, child, pub))
  child.addDependency(child.subscribers, dependency(semver, parent, pub), debug)
}

// remove from both dependencies and subscribers
function unlinkNodes(parent, child) {
  //console.log('__ulink')
  removeFromDepSet(parent.dependencies, child)
  removeFromDepSet(child.subscribers, parent)
  //console.log(`UNLINKED ${parent.name}${parent.version} and ${child.name}${child.version}`)
  //console.log(parent.dependencies)
  //console.log('///////////')
  //console.log(child.subscribers)
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

  //const versionPubFilter = filter(d => d['public'])
  //const depPubFilter = map(d => seq(d, versionPubFilter))

  // gets package.json format of dependencies, with symbol for public where needed
  function getDeps(type) {
    return csp.go(function*() {
      //console.log('__get deps')
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
          // throw new Error was here, semverValid does not support release candidates, assume all will be good :)
          console.log(`Invalid dependency value ${deps[k]} - currently only semver or link to archive are supported`)
        }
      })
      if (type === 'peerDependencies' || type === 'publicDependencies' || PUBLIC_DEP_TEST) {
        // public deps - mark them as such
        // use symbol so that we don't mix the public flag with versions
        Object.keys(deps).forEach(k => {
          deps[k]['public'] = true
        })
      }
      return deps
    })
  }

  function getTarballUrl() {
    return csp.go(function*() {
      //console.log('__get url')
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



  // creates a shallow copy of each dependency in the set
  function copyDependencies(depSet, removePublicFlag, filterForPulic) {
    //console.log('__copy deps')
    const ret = {}
    for (let dep in depSet) {
      for (let version in depSet[dep]) {
        if (filterForPulic && !depSet[dep][version]['public']) continue
        ret[dep] = ret[dep] || {}
        ret[dep][version] = clone(depSet[dep][version])
        ret[dep][version]['public'] = removePublicFlag ? undefined : ret[dep][version]['public']
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

    // pub === false -> get's every dependency, otherwise only public
    getDependencyNodes: (pub) => {
      const ret = []
      for (let dep in self.dependencies) {
        for (let version in self.dependencies[dep]) {
          if (self.dependencies[dep][version]['public'] || !pub) {
            if (!self.dependencies[dep][version].resolvedIn) {
              console.log('this is weird')
              console.log(self)
              console.log(self.dependencies[dep][version])
              console.log('--this is weird')
            }
            ret.push(self.dependencies[dep][version].resolvedIn)
          }
        }
      }
      return ret
    },

    checkNode: (visitedSet = new Map()) => {
      if (visitedSet.has(self)) return visitedSet.get(self)
      visitedSet.set(self, [])
      let publicExports = [].concat(...self.getDependencyNodes(true).map(d => d.checkNode(visitedSet)), self)
      visitedSet.set(self, publicExports)
      // TODO optimization
      let privateImports = [].concat(...self.getDependencyNodes(false).map(d => d.checkNode(visitedSet)), self)
      //console.log('privates')
      //console.log(privateImports)
      //visitedSet.delete(self)
      //console.log('/.//./.')
      //console.log(self)
      let checkMap = {}
      for (let dep of privateImports) {
        //flattenDependencies(self.dependencies).forEach(d => console.log(d.name, d.resolvedIn))
        if (checkMap[dep.name] && (checkMap[dep.name].version !== dep.version)) {
          conflictingNodes.add(dep)
          conflictingNodes.add(checkMap[dep.name])
        }
        checkMap[dep.name] = dep
      }
      return publicExports
    },

    test: () => {
      return csp.go(function*() {
        for (let i = 0; i < 5; i++) {
          (yield self.getPkg()).name
        }
      })
    },

    addDependency: (depSet, dependency, debug) => {
      if (debug) {
        //console.log('__add deps')
        //console.log(depSet)
        //console.log(dependency)
      }
      depSet[dependency.name] = depSet[dependency.name] || {}
      const existingSemver = semverExists(dependency.semver, Object.keys(depSet[dependency.name]))
      if (existingSemver === undefined) {
        depSet[dependency.name][dependency.semver] = dependency
      } else if (dependency['public']) {
        // public deps have higher prority
        depSet[dependency.name][existingSemver] = dependency
      }
      if (debug) {
        //console.log('__afteradd deps')
        //console.log(depSet)
        //console.log(dependency)
      }
    },

    resolvePackage: (semverOrUrl = '*') => {
      return csp.go(function*() {
        //console.log('__resolve pkg')
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
        //console.log('__resolve deps')
        console.assert(self.status === 'package-done', 'Dependencies should be resolved right after version')
        self.status = 'private-dependencies-start'
        // installing devDeps only for root package
        // we assume no overlap in private/public/peer deps, otherwise public > peer > dev > private
        const deps = Object.assign(yield getDeps('dependencies'), (self.name === '__root__') ? yield getDeps('devDependencies') : {}, yield getDeps('peerDependencies'), yield getDeps('publicDependencies'))
        const dependencyNodes = yield cspAll(map(Object.keys(deps), pkgName => resolveNode(pkgName, deps[pkgName].semver || deps[pkgName].url)))
        for (let dn of dependencyNodes) {
          linkNodes(self, dn, deps[dn.name].semver || dn.version, deps[dn.name]['public'])
        }
        self.status = 'private-dependencies-done'
      })
    },

    // merge exported dependencies of dependencies with own public deps
    // privateDep - whether we're exporting along a private branch
    // if so, remove the public flag in copyDependencies
    exportDependencies: (privateDep) => {
      //console.log('__export deps')
      // TODO continue here - why don't we work with flattened all the way ?
      // TODO rethink and/or rewrite ? for now ugly to not waste time
      const exportPubDeps = copyDependencies(self.dependencies, false, true)
      // TODO this is horrible, rewrite pleeease
      flattenDependencies(copyDependencies(self.successorDependencies, false, true)).forEach(
        dep => self.addDependency(exportPubDeps, dep)
      )
      let ret = copyDependencies(exportPubDeps, privateDep)
      //console.log(ret)
      return ret
    },

    getPredecessorDependencies: () => {
      //console.log('__get pred deps')
      let predecessorDeps = {}
      for (let sub of flattenDependencies(self.subscribers)) {
        flattenDependencies(sub.resolvedIn.exportDependencies()).forEach(
          d => self.addDependency(predecessorDeps, d)
        )
      }
      return predecessorDeps
    },

    checkDependencies: () => {
      //console.log('__check deps')
      self.checkedDependencies = {passedDeps: {}, conflictingDeps: {}}
      const newDeps = flattenDependencies(self.dependencies)
          .concat(flattenDependencies(self.successorDependencies))
          .map(d => clone(d))
      const prevNames = new Set()
      for (let currentDep of newDeps) {
        let name = currentDep.name
        if (prevNames.has(name)) {
          if (self.checkedDependencies.passedDeps[name] !== undefined) {
            if (self.checkedDependencies.passedDeps[name].resolvedIn !== currentDep.resolvedIn) {
              //sanity-check
              if (self.checkedDependencies.conflictingDeps[name] !== undefined) {
                throw new Error(`Dependency name in both checked and conflicting: ${self.checkedDependencies} , ${newDeps}`)
              }
              // new conflict, move previous dependency from passedDeps to conflicting, add new conflicting
              self.checkedDependencies.conflictingDeps[name] = []
              self.checkedDependencies.conflictingDeps[name].push(self.checkedDependencies.passedDeps[name], currentDep)
              self.checkedDependencies.passedDeps[name] = undefined
            } else {
              // merge semvers, they resolve into at least one version
              self.checkedDependencies.passedDeps[name].semver = `${self.checkedDependencies.passedDeps[name].semver} ${currentDep.semver}`
            }
          } else {
            // find if we can merge with any of the already conflicting ones
            if (self.checkedDependencies.conflictingDeps[name]) {
              for (let conflict of self.checkedDependencies.conflictingDeps[name]) {
                if (conflict.resolvedIn === currentDep.resolvedIn) {
                  conflict.semver = `${conflict.semver} ${currentDep.semver}`
                  continue
                }
              }
            } else {
              // no conflict resolves to same node, add new conflicting
              self.checkedDependencies.conflictingDeps[name].push(currentDep)
            }
          }
        } else {
          // TODO do we need prevNames ? maybe use checkedDeps only
          prevNames.add(name)
          // add non-conflicting
          self.checkedDependencies.passedDeps[name] = currentDep
        }
      }
      if (Object.keys(self.checkedDependencies.conflictingDeps).length) return false
      return true
    },

    crawlAndCollectSuccessorDeps: (updateToken = Symbol()) => {
      //console.log('__Crawl successors')
      if (self.successorToken === updateToken) return
      //console.log('passed token')
      self.successorToken = updateToken
      self.successorDependencies = {}
      for (let dep of flattenDependencies(self.dependencies)) {
        // decend to the lowest child first
        //console.log('descend')
        dep.resolvedIn.crawlAndCollectSuccessorDeps(updateToken)
        flattenDependencies(dep.resolvedIn.exportDependencies(!dep['public'])).forEach(
          d => {
            //console.log(`Add resolved dependency ${d.resolvedIn.name}`)
            self.addDependency(self.successorDependencies, d)
          }
        )
        //console.log('ascend')
      }
    },

    // returns a function that reverses the mutation
    mutate: () => {
      return csp.go(function*() {
        //console.log(`__mutate-- ${self.name}${self.version}`)
        let allSubscribers = flattenDependencies(self.subscribers)
        // make sure we satisfy at least one of the subscribers
        let subToReceiveMutation = sample(allSubscribers)
        if (!subToReceiveMutation) {
          console.log('nosubs')
          console.log(self)
        }
        //console.log(allSubscribers)
        //console.log('^^^^^^^^^^^allubs')
        let pkg = yield self.getPkg()
        let availableMutations = pkg.getAvailableMutations(self.version, subToReceiveMutation.semver)
        //console.log(`available muts: ${availableMutations}`)
        let version = sample(availableMutations)
        let newNode = yield resolveNode(self.name, version)
        let reverse = () => {}
        //console.log('NEW NODE')
        //console.log(newNode)
        // the one subscriber is guaranteed to receive the new node
        // for the rest, apply where possible
        for (let sub of allSubscribers) {
          if (satisfies(version, sub.semver)) {
            unlinkNodes(sub.resolvedIn, self)
            linkNodes(sub.resolvedIn, newNode, sub.semver, sub['public'], true)
            reverse = () => {
              unlinkNodes(sub.resolvedIn, newNode)
              linkNodes(sub.resolvedIn, self, sub.semver, sub['public'], true)
            }
            //console.log('NEW NODE SUB')
            //console.log(newNode)
            //console.log('SUBBED TO')
            //console.log(sub.resolvedIn.dependencies[newNode.name])
            console.log(`Mutated ${self.name}: ${self.version} -> ${newNode.version} for ${sub.resolvedIn.name}`)
            break // consider this break
          }
        }
        return reverse
      })
    },

    // TODO - separate download and install into different worker groups?
    // TODO - export bin files (according to documentation) to .bin as symlinks
    downloadAndInstall: (rootPath) => {
      return csp.go(function*() {
        //console.log('__down adn inst')
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
        //console.log('__symlink')
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
      //console.log('__crawl and check')
      if (self.checkToken === updateToken) return
      self.checkToken = updateToken
      if (!self.checkDependencies()) {
        // TODO simplify confl. desp structure
        for (let key of Object.keys(self.checkedDependencies.conflictingDeps)) {
          let arr = self.checkedDependencies.conflictingDeps[key].map(d => {
            if (isEmpty(d.resolvedIn.subscribers)) {
              debugroot.crawlAndPrint()
            }
            return d.resolvedIn
          })
          conflictingNodes = conflictingNodes.concat(arr)
        }
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

    crawlAndPrintSubs: (updateToken = Symbol(), offset = 0) => {
      if (self.checkToken === updateToken) {
        return
      }
      console.log(`${self.name} ${self.version}`)
      console.log('subs>>')
      console.log(self.subscribers)
      self.checkToken = updateToken
      flattenDependencies(self.dependencies).forEach(d => d.resolvedIn.crawlAndPrintSubs(updateToken, offset+2))
    },

    // skip argument allows us to ommit root node when needed
    crawlAndFlatten: (updateToken = Symbol(), skip = false) => {
      //console.log('__crawl and flat')
      if (self.checkToken === updateToken) return []
      let ret = skip ? [] : [self]
      self.checkToken = updateToken
      flattenDependencies(self.dependencies).forEach(d => ret = ret.concat(d.resolvedIn.crawlAndFlatten(updateToken)))
      return ret
    },
  }

  return self
}
