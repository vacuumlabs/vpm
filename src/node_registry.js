import csp from 'js-csp'
const semverCmp = require('semver-compare')
import {satisfies, rcompare} from 'semver'
import {map, filter, seq} from 'transducers.js'
import {set, get} from 'lodash'
import {cspAll} from './lib/csp_utils'
import {getIn} from './lib/state_utils'
import {getPackageInfo} from './pkg_registry'

/* -- comment section --

TODO some of these comments are outdated, fix

nodeRegistry = {
  name => {
    version => {
      mergedSemver: semver,
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

TODO on pkg, add method/value with only relevant versions (as symbol ?)

TODO order packages from conflicting branches by depth (order all ?),
annealing - greater temp == greater chance to jump past (to shallower)
non-conflicting dependency

TODO mutations - propagate only upwards

factories should be kept clear of csp, if asynchronicity is required in
object creation they are wrapped in createX function

when checking public deps compatibility:
 - own public deps - defined in the package itself
 - on each dependency (todo method to collect these):
   - inherited - through private dep, won't get passed further
   - public - either own pubDeps or one passed down along public 'branch' - passed further
 - on each subscriber (dependent package)
   - nothing, but we need reference to it so that we can ask for his merged deps

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

//factory
function dependency(semver, node, pub) {

  // TODO mutate

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

  // root package has dependencies directly on itself, without having a version
  function getDeps(type, rootPkg = false) {
    return csp.go(function*() {
      let ver
      if (rootPkg) {
        ver = yield self.getPkg()
      } else {
        ver = getIn(
          yield self.getPkg(),
          ['versions', self.version],
        )
      }
      let deps = getIn(ver, [type], {last: {}})
      if (type !== 'dependencies') {
        // public deps - mark them as such
        // use symbol so that we don't mix the public flag with versions
        Object.keys(deps).forEach(k => deps[k][Symbol.for('public')] = true)
      }
      return deps
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
    status: 'init', // mostly for debug
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

    subscribe: (semver, node) => {
      self.addDependency(self.subscribers, dependency(semver, node))
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

    resolveDependencies: () => {
      return csp.go(function*() {
        console.assert(self.status === 'version-done', 'Dependencies should be resolved right after version')
        self.status = 'private-dependencies-start'
        // we assume no overlap in private/public/peer deps, otherwise public > peer > private
        const deps = Object.assign(yield getDeps('dependencies'), yield getDeps('peerDependencies'), yield getDeps('publicDependencies'))
        const dependencyNodes = yield cspAll(map(Object.keys(deps), pkgName => resolveNode(pkgName, deps[pkgName])))
        for (let dn of dependencyNodes) {
          self.addDependency(self.dependencies, dependency(deps[dn.name], dn, deps[Symbol.for('public')]))
          dn.subscribe(deps[dn.name], self)
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
      for (let dep of flattenDependencies(self.dependencies)) {
        // decend to the lowest child first
        dep.resolvedIn.crawlAndCollectSuccessorDeps(updateToken)
        flattenDependencies(dep.resolvedIn.exportDependencies(!dep[Symbol.for('public')])).forEach(
          d => self.addDependency(self.successorDependencies, d)
        )
      }
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
    }
  }

  return self
}
