import csp from 'js-csp'
import {set, get} from 'lodash'
import {getPackageInfo, cspAll} from './csp_utils.js'
import semver from 'semver'
import semverCmp from 'semver-compare'
import t from 'transducers.js'
import {getIn} from 'stateUtils'

let {map, filter} = t

const registry = {}
const getter = getPackageInfo(registry, 20)

const nodeRegistry = {}
/*
{
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

//factories should be kept clear of csp, if asynchronicity is required in object creation they are wrapped in createX function

// finds existing node that fits semver range, or creates a new one
function resolveNRV(name, semver) {
  return csp.go(function*() {
    let nr = get(nodeRegistry, name)
    nr = nr || set(nodeRegistry, name, {})
    // try to match versions
    for (let version in nr) {
      if (semver.satisfies(version, semver)) {
        return nr[version]
      }
    }
    // first, create node with new version - get highest possible
    let node = yield createNode(name, semver) // TODO returns node with concrete version
    // use this node to create NRV, which will be referenced by nodes that
    let nrv = set(nodeRegistry, [name, node.version], nodeRegistryVersion(name, node.version, semver))
    // at this point NRV can be referenced (if same version satisfies different dependencies)
    // yet, we signal the parent (the one who requested this node version) only once dependencies
    // of underlaying node are resolved - this way, the parent will know when his 'subtree' is complete
    yield node.resolveDependencies()
    yield nrv.channel.put(node)
    return nrv
  })
}

// when checking public deps compatibility:
//  - own public deps - defined in the package itself
//  - on each dependency (todo method to collect these):
//    - inherited - through private dep, won't get passed further
//    - public - either own pubDeps or one passed down along public 'branch' - passed further
//  - on each subscriber (dependent package)
//    - nothing, but we need reference to it so that we can ask for his merged deps

// factory
function nodeRegistryVersion(name, version, initialSemver = '*') {

  function mergeSubscribersSemver(subscribers) {
    return subscribers.reduce((merged, sub) => `${merged} ${sub.semver}`)
  }

  function gatherDependencies() {

  }

  //backup for cut-out code
  function depSemverOverlap(depOne, depTwo) {
    return csp.go(function*() {
      if (depOne[name] !== depTwo[name]) return false
      if (depOne[resolvedIn] === depTwo[resolvedIn]) return true
      //if (semverCmp.cmp(setOne[name].semver,setTwo[name].semver)) return true
      const pkg = yield getter(depOne[name])
      return !!semver.maxSatisfying(Object.keys(pkg.versions, `${setOne[name].semver} ${setTwo[name].semver}`))
    })
  }

  // returns {checkedDeps, conflictingDeps, editedDeps}
  function crosscheckDependencies(setOne, setTwo) {
    const ret = {
      checkedDeps: {},
      conflictingDeps: {},
      editedDeps: {}
    }
    for (let name in setOne) {
      const pkg = getter(name)
      if (setTwo[name] !== undefined) {
        if (semverCmp.cmp(setOne[name].semver,setTwo[name].semver)) {
          //check if semvers have overlap (with at least one existing version of package)
          if () {

          } else {

          } 
        } else {
          // if semvers are the same, there's no conflict

        }  
      }
    }
  }

  return {
    name: name,
    version: version,
    mergedSemver: initialSemver, // TODO this might get removed, we'll see about the public resolve algorithm
    status: 'init',
    subscribers: [],
    dependencies: {},
    pkg: getter(name),
    
    // TODO move inher/pubs to resolveDeps, nothing for them to do here
    addDependent: (semver, node) => {
      return csp.go(function*() {
        // TODO the semver part is probably useless, remove later ?
        // cmp returns 0 if semvers match, 1/-1 otherwise - thruthy value of reduce means there wasn't a match
        //if (this.semvers.reduce((sum, v) => sum && semverCmp.cmp(semver, v), -1)) {
          // create new
        //} else {
        //}
        this.subscribers.push({
          semver: semver,
          node: node
        })
        this.mergedSemver = mergeSubscribersSemver(this.subscribers) // TODO same here
        //TODO fix - no channel
        return yield csp.peek(this.channel) // won't subscribe to dependency until it exists in the channel
      })
    },

    resolveVersion: (semver) => {
      return csp.go(function*() {
        
      })
    },

    resolveDependencies: () => {
      return csp.go(function*() {
        return yield this.resolveCommon(this.pkgChan.peek().versions[this.version].dependencies)
      })
    },

    resolveBasePackage: () => {
      return csp.go(function*() {
        // TODO merge deps/dev-deps/peer-deps
        return yield this.resolveCommon(this.pkgChan.peek().dependencies)
      })
    },

    resolveCommon: (deps) => {
      return csp.go(function*() {
      // TODO getIn deps
        const dependencyNodes = cspAll(map(deps.keys, pkgName => resolveNRV(pkgName, deps[pkgName])))
        for (let dn of dependencyNodes) {
          this.dependencies.push({
            name: dn.name,
            semver: deps[dn.name],
            resolvedIn: dn
          })
        }
        // TODO public deps
        // next step could be done in parallel with previous cspAll (subscribing as we're getting dependencyNodes back),
        // but that would probably not provide any performance gain and would only reduce legibility
        return yield cspAll(map(dependencyNodes, dn => dn.addDependent(this, this.dependencies[dn.name])))
      })
    },

    // returns {inheritedDeps, publicDeps}
    exportDependencies: () => {
      const depMap = new Map()
      for (let dep of this.dependencies) {
        let {depIn, depPub} = dep.exportDependencies()

      }
    }
  }
}

function createNode(name, semver) {
  return csp.go(function*() {
    let pkg = yield getter(name)
    return node(pkg, semver)
  })
}

//factory
// TODO each node will carry info about failing pub deps
// TODO method to 'sever' the node and it's children (in terms of public deps)
// each
function node(pkg, semver) {

  // root package verson || get concrete satisfying version from semver - currently highest possible
  const version = pkg.version || filter(pkg.versions.keys().sort(semver.rcompare), v => semver.satisfies(v, semver))[0]
  if (version === undefined) throw new Error('No version satisfies requirements') // TODO return false and handle

  return {
    name: pkg.name,
    pkgJson: pkg,
    semver: semver,
    version: version,
    status: 'unresolved',
    dependencies: {},

    
}
