import http from 'http'
import csp from 'js-csp'
import {isEqual, isEmpty} from 'lodash'
import {rcompare, satisfies} from 'semver'

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

// generic GET which returns csp-channel
// TODO: rewrite this in a more simple form:
//   while (not success) {
//     yield try-http-request
//   }
//   return result
export function cspHttpGet(options) {
  let reschan = csp.chan(1)

  function processResponse(response) {
    let str = []
    //another chunk of data has been recieved, so append it to `str`
    response.on('data', function(chunk) {
      str.push(chunk)
    })
    //the whole response has been recieved, so we just print it out here
    response.on('end', function() {
      csp.putAsync(reschan, str.join(''))
      reschan.close()
      return reschan
    })
  }

  // for now just redo the request on connection refuse,
  // otherwise print and ignore
  function requestAndHandleErrors(options, callback) {
    http.request(options, callback).on('error', function(err) {
      console.log('http error')
      console.log(err)
      if (err.code === 'ECONNREFUSED') {
        console.log('Connection to registry refused, re-trying (Ctr+C to stop...)')
        requestAndHandleErrors(options, callback)
      }
    }).end()
  }

  requestAndHandleErrors(options, processResponse)
  return reschan
}

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
    let options = {
      host: 'registry.npmjs.org',
      path: `/${pkg}`
    }
    let pkgObj = JSON.parse(yield csp.take(cspHttpGet(options)))
    if (Object.keys(pkgObj).length === 0) {
      // pkg not found, TODO try find in 'custom' registry for testing ?
      // we'll need to create and get packages with conflicting public deps
      throw new Error('Package not found')
    }
    pkgObj.getAvailableMutations = availableMutations.bind(null, pkgObj)
    return pkgObj
  })
}

/** returns `pkgInfoGetter`, `pkgInfoGetter(pkg)` retrieves info about a single pkg, internally uses
 * `nrConnections` number of workers and will use `registry` as its cache
**/

export function getPackageInfo(nrConnections = 20) {
  let ch = csp.chan()

  function* spawnWorker() {
    while (true) {
      let [pkg, resChan] = yield csp.take(ch)
      let res = yield csp.take(_getPackageInfo(pkg))
      let errCount = 0
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

  // pkfInfoGetter
  return (pkg) => {
    return csp.go(function*() {
      if (pkg in registry) {
        if ('package' in registry[pkg]) {
          return yield csp.peek(registry[pkg])
        }
      }
      // resChan has to have buffer of a size 1 to be peek-able
      let resChan = csp.chan(1)
      registry[pkg] = resChan
      yield csp.put(ch, [pkg, resChan])
      return yield csp.peek(resChan)
    })
  }
}
