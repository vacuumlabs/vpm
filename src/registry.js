import csp from 'js-csp'
import {set, get} from 'lodash'
import {getPackageInfo, cspAll} from './csp_utils.js'
import semverCmp from 'semver-compare'
import t from 'transducers.js'
import {getIn} from 'stateUtils'
const {map, filter, seq} = t

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
// TODO get only non-conflicting from subscribers, let them resolve their conflicts
// TODO circular dependencies - use update token
// TODO we should choose between mutating and attempts at merging semvers

//factories should be kept clear of csp, if asynchronicity is required in object creation they are wrapped in createX function

// when checking public deps compatibility:
//  - own public deps - defined in the package itself
//  - on each dependency (todo method to collect these):
//    - inherited - through private dep, won't get passed further
//    - public - either own pubDeps or one passed down along public 'branch' - passed further
//  - on each subscriber (dependent package)
//    - nothing, but we need reference to it so that we can ask for his merged deps

// -- end comment section --

const registry = {}
const getter = getPackageInfo(registry, 20)

const nodeRegistry = {}
const conflictingNodes = []

// finds existing node that fits semver range, or creates a new one
function resolveNode(name, semver) {
  return csp.go(function*() {
    let nr = get(nodeRegistry, name) || set(nodeRegistry, name, {})
    // try to match versions
    for (let version in nr) {
      if (semver.satisfies(version, semver)) {
        return nr[version]
      }
    }
    let node = nodeFactory(name)
    yield node.resolveVersion()
    set(nodeRegistry, [name, node.version], node)
    yield node.resolveDependencies()
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
    resolvedIn: node,
    status: 'init', // signals when the node for dependency has changed
  }
}

// factory
function nodeFactory(name) {

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
      this.pkg.peek(),
      ['versions', this.version, type],
      {any: getIn(this.pkg.peek(), [type])}
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

  return {
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

    subscribe: (semver, node) => {
      this.subscribers.push({
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

    resolveVersion: (semver) => {
      return csp.go(function*() {
        console.assert(this.status === 'init', 'Version should be resolved right after node initialization.')
        this.status = 'version-start'
        this.version =
          (yield this.pkg.peek()).version ||
          filter((yield this.pkg.peek()).versions.keys().sort(semver.rcompare), v => semver.satisfies(v, semver))[0]
        console.assert(this.version !== undefined, 'No version satisfies requirements') // TODO return false and handle
        this.status = 'version-done'
      })
    },

    resolveDependencies: () => {
      return csp.go(function*() {
        console.assert(this.status === 'version-done', 'Dependencies should be resolved right after version')
        this.status = 'private-dependencies-start'
        // we assume no overlap in private/public/peer deps, otherwise public > peer > private
        const deps = Object.assign(getDeps('dependencies'), getDeps('peerDependencies'), getDeps('publicDependencies'))
        const dependencyNodes = yield cspAll(map(Object.keys(deps), pkgName => resolveNode(pkgName, deps[pkgName])))
        for (let dn of dependencyNodes) {
          this.addDependency(this.dependencies, dependency(deps[dn.name], dn, deps[Symbol.for('public')]))
          dn.subscribe(deps[dn.name], this)
        }
        this.status = 'private-dependencies-done'
      })
    },

    // merge exported dependencies of dependencies with own public deps
    // privateDep - whether we're exporting along a private branch
    // if so, remove the public flag in copyDependencies
    exportDependencies: (privateDep) => {
      const exportPubDeps = seq(this.dependencies, depFilterForSymbol('public'))
      flattenDependencies(seq(this.successorDependencies, depFilterForSymbol('public'))).forEach(
        dep => this.addDependency(exportPubDeps, dep)
      )
      return copyDependencies(exportPubDeps, privateDep)
    },

    getPredecessorDependencies: () => {
      let predecessorDeps = {}
      for (let sub of this.subscribers) {
        sub.node.exportDependencies().forEach(
          d => this.addDependency(predecessorDeps, d)
        )
      }
      return predecessorDeps
    },

    checkDependencies: () => {
      this.checkedDependencies = {passedDeps: {}, conflictingDeps: {}}
      const newDeps = flattenDependencies(this.dependencies)
          .concat(flattenDependencies(this.successorDependencies))
          .concat(flattenDependencies(this.getPredecessorDependencies()))
      const prevNames = new Set(Object.keys(this.checkedDependencies.passedDeps).concat(Object.keys(this.checkedDependencies.conflictingDeps)))
      for (let name in newDeps) {
        if (prevNames.has(name)) {
          if (this.checkedDependencies.passedDeps[name] !== undefined) {
            if (this.checkedDependencies.passedDeps[name].resolvedIn !== newDeps[name].resolvedIn) {
              //sanity-check
              if (this.checkedDependencies.conflictingDeps[name] !== undefined) {
                throw new Error(`Dependency name in both checked and conflicting: ${this.checkedDependencies} , ${newDeps}`)
              }
              // new conflict, move previous dependency from passedDeps to conflicting, add new conflicting
              this.checkedDependencies.conflictingDeps[name] = []
              this.checkedDependencies.conflictingDeps[name].push(this.checkedDependencies.passedDeps[name], newDeps[name])
              this.checkedDependencies.passedDeps[name] = undefined
            } else {
              // merge semvers, they resolve into at least one version
              this.checkedDependencies.passedDeps[name].semver = `${this.checkedDependencies.passedDeps[name].semver} ${newDeps[name].semver}`
            }
          } else {
            // find if we can merge with any of the already conflicting ones
            for (let conflict of this.checkedDependencies.conflictingDeps) {
              if (conflict.resolvedIn === newDeps[name].resolvedIn) {
                conflict.semver = `${conflict.semver} ${newDeps[name].semver}`
                continue
              }
            }
            // no conflict resolves to same node, add new conflicting
            this.checkedDependencies.conflictingDeps[name].push(newDeps[name])
          }
        } else {
          // add non-conflicting
          this.checkedDependencies.passedDeps[name] = newDeps[name]
        }
      }
      if (this.checkedDependencies.conflictingDeps.length) return false
      return true
    },

    crawlAndCollectSuccessorDeps: (updateToken = Symbol()) => {
      if (this.successorToken === updateToken) return
      this.successorToken = updateToken
      for (let dep of flattenDependencies(this.dependencies)) {
        // decend to the lowest child first
        dep.resolvedIn.crawlAndCollectSuccessorDeps(updateToken)
        flattenDependencies(dep.exportDependencies(!dep[Symbol.for('public')])).forEach(
          d => this.addDependency(this.successorDependencies, d)
        )
      }
    },

    crawlAndCheck: (updateToken = Symbol()) => {
      if (this.checkToken === updateToken) return
      this.checkToken = updateToken
      if (!this.checkDependencies()) conflictingNodes.push(this)
      flattenDependencies(this.dependencies).forEach(d => d.resolvedIn.crawlAndCheck(updateToken))
    }
  }
}
