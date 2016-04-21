// TODOP: Fix eslint
import http from 'http'
import csp from 'js-csp'
import {isEqual, isEmpty} from 'lodash'
import {rcompare, satisfies} from 'semver'
import {isUri} from 'valid-url'
import {cspDownloadAndExtractTarball, installUrl, cspParseFile, cspHttpGet} from './lib/csp_utils'

// TODO cleanup

// TODOP why is this called pkg_regitstry? Only reason of this file is to export `getPackageInfo`
// function, so it should be called getPackageInfo.js.

// TODOP:
// 0) Is this related to registryStructure, getPackageInfo function or what?
// 1) How this differs from the existing scenario?
// 2) Why Symbol? I don't see any reason for this
/*
TODO each package should have object on Symbol.for('parsedInfo'):
{
  reasonable_ver => {
    dep,devDep,peerDep,pubDep
    tarball // currently might get downloaded twice, but nvm for now
  }
}

*/

// TODOP:
// rename to `cache`
const registry = {}

// returns channel containg info about single package

// TODOP check out the comment:
// exported only for testing purposes
export function _getPackageInfo(pkg) {
  // TODOP: checkout new comment:
  // returns versions satisfying semver for which the package dependencies differ from those found
  // in `version`
  // TODOP: rename `previousVersion` to `version`
  // TODOP: Why is this here? It uses nothing from the parent scope so it should be global helper.
  function availableMutations(pkgObj, previousVersion, semver) {
    let ret = []
    let sortedVersions = Object.keys(pkgObj.versions).sort(rcompare)
    for (let ver of sortedVersions) {
      if (!satisfies(ver, semver)) continue
      // TODO optional dependencies ?
      for (let type of ['dependencies', 'devDependencies', 'peerDependencies', 'publicDependencies']) {
        // TODOP: IMO this would also do a job:
        // if (!isEqual(pkgObj.versions[ver][type] || {} , pkgObj.versions[ver][type]) || {}) {
        if (!isEqual(pkgObj.versions[ver][type], pkgObj.versions[ver][type])) {
          // just to be sure, ignore cases where deps are empty/undefined in both versions
          if ((pkgObj.versions[ver][type] === undefined ||
             isEmpty(pkgObj.versions[ver][type]))
             &&
             ((pkgObj.versions[previousVersion][type] === undefined ||
             isEmpty(pkgObj.versions[previousVersion][type])))) {
            continue
          }
          ret.push(ver)
        }
      }
    }
    return ret
  }

  return csp.go(function*() {
    let jsonString
    if (isUri(pkg)) {
      // install into random temp directory
      // TODO don't install multiple times (?)
      // TODOP: be more specific or remove the TODO
      // TODO error handling
      let randDir = Math.random().toString(36).substring(8)
      yield installUrl(pkg, '/tmp', '', randDir)
      jsonString = yield cspParseFile(`/tmp/${randDir}/package.json`)
    } else {
      jsonString = yield csp.take(cspHttpGet(`http://registry.npmjs.org/${pkg}`))
    }
    let pkgObj = JSON.parse(jsonString)
    if (isEmpty(pkgObj)) {
      throw new Error(`Unable to parse or download ${pkg}`)
    }
    if (Object.keys(pkgObj).length === 0) {
      // pkg not found, TODO try find in 'custom' registry for testing ?
      // we'll need to create and get packages with conflicting public deps
      throw new Error('Package not found')
    }
    // TODOP: detto, don't create the partial here. With `availableMutations` being global helper,
    // you can use is simply as `getAvailableMutations(myPackage)`
    pkgObj.getAvailableMutations = availableMutations.bind(null, pkgObj)
    if (isUri(pkg)) pkgObj.tarball = pkg
    return pkgObj
  })
}

/**
 * returns `pkgInfoGetter`.
 * `pkgInfoGetter(pkg)` retrieves info about a single pkg, internally uses
 * `nrConnections` number of workers and will use `registry` as its cache
 * TODOP: document
**/

export function getPackageInfo(nrConnections = 6) {
  let ch = csp.chan()

  function* spawnWorker() {
    while (true) {
      let [pkg, resChan] = yield csp.take(ch)
      let res = yield csp.take(_getPackageInfo(pkg))
      let errCount = 0
      // error handling
      // TODOP as stated elsewhere: if anything fails, make everything fail.
      while(res instanceof Error) {
        console.log(res)
        console.log(`Error while obtaining packageInfo for ${pkg}`)
        console.log(`Error count: ${++errCount}`)
        res = yield csp.take(_getPackageInfo(pkg))
      }
      yield csp.put(resChan, res)
    }
  }

  for (let i = 0; i < nrConnections; i++) {
    csp.go(spawnWorker)
  }

  // pkfInfoGetter - pkg is either a name or an url to tarball
  return (pkg) => {
    return csp.go(function*() {
      if (pkg in registry) {
        // TODOP: registry[pkg] should be channel; I don't understand the following condition. It's
        // probably a bug? Git blames me for this, so shame on me :)
        if ('package' in registry[pkg]) {
          return yield csp.peek(registry[pkg])
        }
      }
      let resChan = csp.chan(1)
      registry[pkg] = resChan
      yield csp.put(ch, [pkg, resChan])
      return yield csp.peek(resChan)
    })
  }
}
