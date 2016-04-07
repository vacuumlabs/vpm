import csp from 'js-csp'
import semverCmp from 'semver-compare'
import {satisfies, rcompare} from 'semver'
import {map, filter, seq} from 'transducers.js'
import {set, get} from 'lodash'
import {cspAll} from './lib/csp_utils'
import {getIn} from './lib/state_utils'
import {getPackageInfo} from './pkg_registry'
// -- comment section --

// TODO most of these comments are outdated, fix

/*
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
*/


// TODO on pkg, add method/value with only relevant versions (as symbol ?)
// TODO order packages from conflicting branches by depth (order all ?),
//   annealing - greater temp == greater chance to jump past (to shallower) non-conflicting dependency
// TODO mutations - propagate only upwards

//factories should be kept clear of csp, if asynchronicity is required in object creation they are wrapped in createX function

// when checking public deps compatibility:
//  - own public deps - defined in the package itself
//  - on each dependency (todo method to collect these):
//    - inherited - through private dep, won't get passed further
//    - public - either own pubDeps or one passed down along public 'branch' - passed further
//  - on each subscriber (dependent package)
//    - nothing, but we need reference to it so that we can ask for his merged deps

// -- end comment section --


const getter = getPackageInfo()

let nodeRegistry = {}
let conflictingNodes = []

//for testing
export function resetRegistry() {
  nodeRegistry = {}
  conflictingNodes = []
}

// finds existing node that fits semver range, or creates a new one
export function resolveNode(name, semver = '*') {
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
    //yield node.resolveDependencies() // TODO uncomment
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

  //const versionPubFilter = filter(d => d[Symbol.for('public')])
  //const depPubFilter = map(d => seq(d, versionPubFilter))

  function depFilterForSymbol(symName) {
    const innerFilter = filter(d => d[Symbol.for(symName)])
    return map(d => seq(d, innerFilter))
  }

  function getDeps(type) {
    // should throw if both getIns fail
    // one is for base package, other for general package.json
    let deps = getIn(
      csp.peek(this.pkg),
      ['versions', this.version, type],
      {any: getIn(csp.peek(this.pkg), [type])}
    )
    if (type !== 'dependencies') {
      // public deps - mark them as such
      // use symbol so that we don't mix the public flag with versions
      deps = deps.map(d => d[Symbol.for('public')] = true)
    }
    return deps
  }

  //check if semver is equal to any of versions (also semvers)
  function semverExists(semver, versions) {
    for (let ver of versions) {
      if (semverCmp.cmp(semver,ver) === 0) return ver
    }
    return undefined
  }

  // returns an array of dependency objects
  function flattenDependencies(depSet) {
    const ret = []
    for (let dep of depSet) {
      for (let version of dep) {
        ret.push(version)
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

  let self = {
    name: name,
    version: undefined,
    status: 'init', // mostly for debug
    subscribers: [],
    checkToken: Symbol(),
    successorToken: Symbol(),
    dependencies: {},
    successorDependencies: {},
    checkedDependencies: {
      passedDeps: {},
      conflictingDeps: {}
    },
    pkg: getter(name),
    depsReady: csp.chan(1),

    test: () => {
      return csp.go(function*() {
        for (let i = 0; i < 20; i++) {
          console.log((yield csp.peek(self.pkg)).name)
        }
      })
    },

    subscribe: (semver, node) => {
      self.subscribers.push({
        semver: semver,
        node: node
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
          (yield csp.peek(self.pkg)).version ||
          filter((yield csp.peek(self.pkg)).versions.keys().sort(rcompare), v => satisfies(v, semver))[0]
        console.assert(self.version !== undefined, 'No version satisfies requirements') // TODO return false and handle
        self.status = 'version-done'
      })
    },

    resolveDependencies: () => {
      return csp.go(function*() {
        console.assert(self.status === 'version-done', 'Dependencies should be resolved right after version')
        self.status = 'private-dependencies-start'
        // we assume no overlap in private/public/peer deps, otherwise public > peer > private
        const deps = Object.assign(getDeps('dependencies'), getDeps('peerDependencies'), getDeps('publicDependencies'))
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
      for (let sub of self.subscribers) {
        sub.node.exportDependencies().forEach(
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
        flattenDependencies(dep.exportDependencies(!dep[Symbol.for('public')])).forEach(
          d => self.addDependency(self.successorDependencies, d)
        )
      }
    },

    crawlAndCheck: (updateToken = Symbol()) => {
      if (self.checkToken === updateToken) return
      self.checkToken = updateToken
      if (!self.checkDependencies()) conflictingNodes.push(self)
      flattenDependencies(self.dependencies).forEach(d => d.resolvedIn.crawlAndCheck(updateToken))
    }
  }

  return self
}
