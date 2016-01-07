import {getPackageInfo, cspAll} from './csp_utils.js'
import csp from 'js-csp'

function introduce(pkg) {
  return {'name': pkg.name, 'versions': Object.keys(pkg.versions).length}
}

const packageList = ['immutable', 'babel-core', 'js-csp', 'eslint', 'gulp', 'mocha']

// get package info one by one

csp.go(function*() {
  for (let pkg of packageList) {
    let info = yield csp.take(getPackageInfo(pkg))
    console.log(introduce(info))
  }
})


// get package info in parallel.

// first, do all calls, do now wait for anything

let results = packageList.map((pkg) => csp.go(function*() {
  return [pkg, introduce(yield csp.take(getPackageInfo(pkg)))]
}))

// wait until we have all results

csp.go(function*() {
  console.log(yield cspAll(results))
})

