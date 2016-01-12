// everything related to building up local registry
import csp from 'js-csp'
import {getPackageInfo} from './csp_utils.js'
import Queue from 'fastqueue'

const queue = new Queue
const registry = {}
const getter = getPackageInfo(registry, 10)

function getAllDependencies(pkg) {
  return csp.go(function*() {
    queue.push(pkg)
    while (true) {
      if (queue.length === 0) {
        break
      }
      let pkg = queue.shift()
      console.log('start', pkg)
      let pkgInfo = yield csp.take(getter(pkg, true))
      console.log('end', pkg)

      let tbd = {}
      if ('versions' in pkgInfo) {
        for (let ver in pkgInfo.versions) {
          let verData = pkgInfo.versions[ver]
          if ('dependencies' in verData) {
            for (let dep in verData.dependencies) {
              tbd[dep] = true
            }
          }
        }
      }
      for (let dep in tbd) {
        if (registry[dep] === undefined) {
          queue.push(dep)
          getter(dep, false)
        }
      }
    }
    return null
  })
}

csp.go(function*() {
  yield csp.take(getAllDependencies('eslint'))
})

//csp.go(function*() {
//  yield csp.timeout(10000)
//})

//// TODO this is SLOW (really slow - dependencies seem to change a lot in big packages), should only get pkgInfo on demand
//// TODO rewrite to allow multiple getter routines sometime in the future (for now, a single goroutine making connections
//// should be good enough (?), since we already run into occasional ECONNREFUSED as it is)
//function* constructRegistry(dependencies) {
//  dependencies.forEach(pushIfNew)
//  let pkg
//  while ((pkg = queue.shift()) !== undefined) {
//    yield csp.put(reqChan, pkg)
//  }
//  reqChan.close()
//  return registry
//}
//
//// reads package names from channel, requests info from server and constructs entry in registry
//function* getter() {
//  let pkg
//  while ((pkg = yield csp.take(reqChan)) !== csp.CLOSED) {
//    console.log(pkg) // debug print
//    let pkgInfo = yield csp.take(getPackageInfo(pkg))
//    if (pkgInfo.versions === undefined) continue // TODO handle this! (unpublished packages)
//    registry[pkg] = Object.assign({}, t.seq(pkgInfo['versions'], transduceValue(filterKeysForRegistry)))
//    let registryPkg = registry[pkg] // TODO should assigns like this exist or does javascript cache/optimise repeated object lookups ?
//    for (let ver in registryPkg) {
//      if (registryPkg[ver]['dependencies'] === undefined) continue
//      t.toArray(registryPkg[ver]['dependencies'], extractKey).forEach(pushIfNew)
//    }
//  }
//}
//
//const packageList = ['js-csp', 'immutable', 'eslint']//, 'babel-core', 'js-csp', 'eslint', 'gulp', 'mocha']
//
//// returns a channel that ultimately returns registry
//export const registryChannel = (packageList) => csp.go(function*() {
//  csp.spawn(getter())
//  return yield csp.take(csp.spawn(constructRegistry(packageList)))
//})
//
//// test
////let ch = registryChannel(packageList)
////csp.takeAsync(ch, (r) => console.log(r))
