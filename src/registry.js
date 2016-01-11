// everything related to building up local registry
import csp from 'js-csp'
import t from 'transducers.js'
import {getPackageInfo} from './csp_utils.js'
import Queue from 'fastqueue'

const queue = new Queue
const registry = {}
const reqChan = csp.chan()

const extractKey = t.map(kv => kv[0])
const filterKeysForRegistry = t.filter(kv => /^tarball$|^dependencies$/.test(kv[0]))

const transduceValue = (transducer) => t.map(kv => [kv[0], t.seq(kv[1], transducer)])

function pushIfNew(dep) {
  if (!(dep in registry)) {
    registry[dep] = undefined
    queue.push(dep)
  }
}

// TODO this is SLOW (really slow - dependencies seem to change a lot in big packages), should only get pkgInfo on demand
// TODO rewrite to allow multiple getter routines sometime in the future (for now, a single goroutine making connections
// should be good enough (?), since we already run into occasional ECONNREFUSED as it is)
function* constructRegistry(dependencies) {
  dependencies.forEach(pushIfNew)
  let pkg
  while ((pkg = queue.shift()) !== undefined) {
    yield csp.put(reqChan, pkg)
  }
  reqChan.close()
  return registry
}

// reads package names from channel, requests info from server and constructs entry in registry
function* getter() {
  let pkg
  while ((pkg = yield csp.take(reqChan)) !== csp.CLOSED) {
    console.log(pkg) // debug print
    let pkgInfo = yield csp.take(getPackageInfo(pkg))
    if (pkgInfo.versions === undefined) continue // TODO handle this! (unpublished packages)
    registry[pkg] = Object.assign({}, t.seq(pkgInfo['versions'], transduceValue(filterKeysForRegistry)))
    let registryPkg = registry[pkg] // TODO should assigns like this exist or does javascript cache/optimise repeated object lookups ?
    for (let ver in registryPkg) {
      if (registryPkg[ver]['dependencies'] === undefined) continue
      t.toArray(registryPkg[ver]['dependencies'], extractKey).forEach(pushIfNew)
    }
  }
}

const packageList = ['js-csp', 'immutable', 'eslint']//, 'babel-core', 'js-csp', 'eslint', 'gulp', 'mocha']

// export function that spawns channel that yields registry
// TODO is this a good pattern ? or should we just export generator function and spawn it when needed ?
export const registryChannel = () => csp.go(function*() {
  csp.spawn(getter())
  return yield csp.take(csp.spawn(constructRegistry(packageList)))
})

// test

let ch = registryChannel()
csp.takeAsync(ch, (r) => console.log(r))
