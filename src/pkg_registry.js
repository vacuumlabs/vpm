import http from 'http'
import csp from 'js-csp'
import {isEqual, isEmpty} from 'lodash'
import {rcompare, satisfies} from 'semver'
import {isUri} from 'valid-url'
import {cspDownloadAndExtractTarball, installUrl, cspParseFile, cspHttpGet} from './lib/csp_utils'

// TODO cleanup

/*
TODO each package should have object on Symbol.for('parsedInfo'):
{
  reasonable_ver => {
    dep,devDep,peerDep,pubDep
    tarball // currently might get downloaded twice, but nvm for now
  }
}

*/

const registry = {}

// returns channel containg info about single package
export function _getPackageInfo(pkg) {

  // returns versions satisfying semver that change dependencies
  function availableMutations(pkgObj, previousVersion, semver) {
    let ret = []
    let sortedVersions = Object.keys(pkgObj.versions).sort(rcompare)
    for (let ver of sortedVersions) {
      if (!satisfies(ver, semver)) continue
      // TODO optional dependencies ?
      for (let type of ['dependencies', 'devDependencies', 'peerDependencies', 'publicDependencies']) {
        if (!isEqual(pkgObj.versions[ver][type], pkgObj.versions[ver][type])) {
          // just to be sure, ignore cases where deps are empty/undefined in both versions
          if ((pkgObj.versions[ver][type] === undefined || (isEmpty(pkgObj.versions[ver][type]))) && (pkgObj.versions[previousVersion][type] === undefined || (isEmpty(pkgObj.versions[previousVersion][type])))) continue
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
    pkgObj.getAvailableMutations = availableMutations.bind(null, pkgObj)
    if (isUri(pkg)) pkgObj.tarball = pkg
    return pkgObj
  })
}

/** returns `pkgInfoGetter`, `pkgInfoGetter(pkg)` retrieves info about a single pkg, internally uses
 * `nrConnections` number of workers and will use `registry` as its cache
**/

export function getPackageInfo(nrConnections = 6) {
  let ch = csp.chan()

  function* spawnWorker() {
    while (true) {
      let [pkg, resChan] = yield csp.take(ch)
      let res = yield csp.take(_getPackageInfo(pkg))
      let errCount = 0
      // error handling
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
        if ('package' in registry[pkg]) {
          return yield csp.peek(registry[pkg])
        }
      }
      // resChan has to have buffer of a size 1 to be peekable
      let resChan = csp.chan(1)
      registry[pkg] = resChan
      yield csp.put(ch, [pkg, resChan])
      return yield csp.peek(resChan)
    })
  }
}
