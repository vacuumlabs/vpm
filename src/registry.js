import csp from 'js-csp'
import {set, get} from 'lodash'
import {getPackageInfo} from './csp_utils.js'
import {flattenShallow} from './useful.js'
import semver from 'semver'
import Queue from 'fastqueue'
import t from 'transducers.js'
import {getIn} from 'stateUtils'

let {map,filter} = t

const queue = new Queue
const registry = {}
const waiting = [] // channels of packages waiting to be fetched
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
    let node = yield createNode // TODO returns node with concrete version
    // use this node to create NRV, which will be referenced by nodes that
    let nrv = set(nodeRegistry, [name, node.version], nodeRegistryVersion(version))
    // at this point NRV can be referenced (if same version satisfies different dependencies)
    // yet, we signal the parent (the one who requested this node version) only once dependencies
    // of underlaying node are resolved - this way, the parent will know when his 'subtree' is complete
    yield node.resolveDependencies()
    yield nrv.channel.put(node)
    return nrv
  })
}

// factory
function nodeRegistryVersion(name, version) {

  function mergeSubscribersSemver(subscribers) {
    return subscribers.reduce((merged, sub) => return `${merged} ${sub.semver}`)
  }

  // channel used the same way as with registry - the node is stored there and retrieved via 'peek'
  let ch = csp.chan(1)

   return {
    version: version,
    mergedSemver: '*', // TODO this might get removed, we'll see about the public resolve algorithm
    subscribers: [],
    channel: ch,
    publicDeps: {
      // name, semver, origin - if multiple origins, multiple entries in publicDeps
    },
    subscribe: (node, semver) => {
      return csp.go(function*() {
        subscribers.push({
          node: node,
          semver: semver
        })
        this.mergedSemver = mergeSubscribersSemver(this.subscribers) // TODO same here
        return yield csp.peek(this.channel) // won't subscribe un
      })
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
function node(pkg, semver) {

  // root package verson || get concrete satisfying version from semver - highest possible
  const version = pkg.version || filter(pkgJson.versions.keys().sort(semver.rcompare), v => semver.satisfies(v, semver))[0]
  if (version === undefined) throw new Error('No version satisfies requirements') // TODO return false and handle

  return {
    name: pkg.name,
    pkgJson: pkg,
    version: version,
    status: 'unresolved',
    dependencies: {},

    resolveDependencies: () => {
      return csp.go(function*() {
        return yield this.resolveCommon(pkgJson.versions[version].dependencies)
      })
    }

    resolveBasePackage: () => {
      return csp.go(function*() {
        // TODO merge deps/dev-deps/peer-deps
        return yield this.resolveCommon(pkgJson.dependencies)
      })
    }

    resolveCommon: (deps) => {
      return csp.go(function*() {
      // TODO getIn deps
        const dependencyNodes = cspAll(map(deps.keys, pkgName => resolveNRV(pkgName, deps[pkgName])))
        for (let dn of dependencyNodes) {
          this.dependencies[dn.name] = {
            name: dn.name,
            semver: deps[dn.name],
            resolvedIn: dn
          }
        }
        // TODO public deps
        // next step could be done in parallel with previous cspAll (subscribing as we're getting dependencyNodes back),
        // but that would probably not provide any performance gain and would only reduce legibility
        return yield cspAll(map(dependencyNodes, dn.addDependent(this, versionPackage.dependencies[dn.name])))
      })
    }
  }
}
