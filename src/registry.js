import csp from 'js-csp'
import {set, get, clone} from 'lodash'
import {getPackageInfo, cspAll} from './csp_utils.js'
import semver from 'semver'
import semverCmp from 'semver-compare'
import t from 'transducers.js'
import {getIn} from 'stateUtils'

// -- comment section --

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

//factories should be kept clear of csp, if asynchronicity is required in object creation they are wrapped in createX function

// when checking public deps compatibility:
//  - own public deps - defined in the package itself
//  - on each dependency (todo method to collect these):
//    - inherited - through private dep, won't get passed further
//    - public - either own pubDeps or one passed down along public 'branch' - passed further
//  - on each subscriber (dependent package)
//    - nothing, but we need reference to it so that we can ask for his merged deps

// -- end comment section --

let {map, filter} = t

const registry = {}
const getter = getPackageInfo(registry, 20)

const nodeRegistry = {}

// returns {checkedDeps, conflictingDeps}
// checkedDeps are shallow clones of node dependencies
// previous iteration excepts same format as is returned (so that we can use this function as reducer)
// conflictingDeps: {name: [dep1, dep2 ...]}
function checkDependencies(previousIteration, newDeps) {
  const ret = {
    checkedDeps: {},
    conflictingDeps: {},
  }
  const prevNames = new Set(Object.keys(previousIteration.checkedDeps).concat(Object.keys(previousIteration.conflictingDeps)))
  for (let name in newDeps) {
    if (prevNames.has(name)) {
      if (previousIteration.checkedDeps[name] !== undefined) {
        if (previousIteration.checkedDeps[name].resolvedIn !== newDeps[name].resolvedIn) {
          //sanity-check
          if (previousIteration.conflictingDeps[name] !== undefined) {
            throw new Error(`Dependency name in both checked and conflicting: ${previousIteration} , ${newDeps}, ${ret}`)
          }
          // new conflict, move previous dependency from checkedDeps to conflicting, add new conflicting
          previousIteration.conflictingDeps[name] = []
          previousIteration.conflictingDeps[name].push(previousIteration.checkedDeps[name], clone(newDeps[name]))
          previousIteration.checkedDeps[name] = undefined
        } else {
          // merge semvers, they resolve into at least one version
          previousIteration.checkedDeps[name].semver = `${previousIteration.checkedDeps[name].semver} ${newDeps[name].semver}`
        }
      } else {
        // find if we can merge with any of the already conflicting ones
        for (let conflict of previousIteration.conflictingDeps) {
          if (conflict.resolvedIn === newDeps[name].resolvedIn) {
            conflict.semver = `${conflict.semver} ${newDeps[name].semver}`
            continue
          }
        }
        // no conflict resolves to same node, add new conflicting
        previousIteration.conflictingDeps[name].push(clone(newDeps[name]))
      }
    } else {
      // add non-conflicting
      previousIteration.checkedDeps[name] = clone(newDeps[name])
    }
  }
}

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
    let node = node(name)
    yield node.resolveVersion()
    set(nodeRegistry, [name, node.version], node)
    yield node.resolveDependencies()
    return node
  })
}

//factory
function dependency(semver, node) {

  // TODO mutate

  return {
    name: node.name,
    semver: semver,
    resolvedIn: node,
    status: 'init', // signals when the node for dependency has changed
  }
}

// factory
function node(name) {

  return {
    name: name,
    version: undefined,
    status: 'init',
    subscribers: [],
    dependencies: {},
    pkg: getter(name),
    depsReady: csp.chan(1),

    subscribe: (semver, node) => {
      this.subscribers.push({
        semver: semver,
        node: node
      })
    },

    resolveVersion: (semver) => {
      return csp.go(function*() {
        this.version = this.pkg.peek().version || filter(this.pkg.peek().versions.keys().sort(semver.rcompare), v => semver.satisfies(v, semver))[0]
        if (this.version === undefined) throw new Error('No version satisfies requirements') // TODO return false and handle
      })
    },

    resolveDependencies: () => {
      return csp.go(function*() {
        if (this.version === undefined) throw new Error('Version needs to be set before resolving dependencies')
        //should throw if both getIns fail
        const deps = getIn(
          this.pkg.peek(),
          ['versions', this.version, 'dependencies'],
          {any: getIn(this.pkg.peek(), ['dependencies'])}
        )
        const dependencyNodes = yield cspAll(map(Object.keys(deps), pkgName => resolveNode(pkgName, deps[pkgName])))
        for (let dn of dependencyNodes) {
          this.dependencies[dn.name] = dependency(deps[dn.name], dn)
          dn.subscribe(deps[dn.name], this)
        }
      })
    },

    // returns {inheritedDeps, publicDeps}
    exportDependencies: () => {

    }
  }
}
