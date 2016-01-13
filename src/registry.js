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

