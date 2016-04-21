import csp from 'js-csp'
import {cloneDeep} from 'lodash'
const fs = require('fs')
const domain = require('domain')
const request = require('request')
const tar = require('tar')
const gunzip = require('gunzip-maybe')
const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
import through from 'through'

// patch csp with a peek method: obtain a value from channel without removing it
csp.peek = function(ch) {
  return csp.go(function*() {
    //console.log('before:')
    //console.log(ch)
    let res = yield csp.take(ch)
    if (res === null) {
      console.log('RES IS NULL!!!???')
      //console.log(res)
    }
    //console.log('right after:')
    //console.log(ch)
    yield csp.put(ch, res)
    //console.log('after:')
    //console.log(ch)
    return cloneDeep(res)
  })
}

export function cspAll(channels) {
  return csp.go(function*() {
    let res = yield csp.operations.into([], csp.operations.merge(channels))
    return res
  })
}

// returns a channel that blocks until function callback is called
// the channel yields either an error or csp.CLOSED
export function cspy(fn, ...args) {
  let ch = csp.chan()
  fn(...args, (err) => {
    if (err) csp.putAsync(ch, err)
    ch.close()
  })
  return ch
}

// cspy when data are returned in callback
export function cspyData(fn, ...args) {
  let ch = csp.chan()
  fn(...args, (err, data) => {
    if (err) throw err
    csp.putAsync(ch, data)
    ch.close()
  })
  return ch
}

// fs.stat csp version
export function cspStat(path, lstat = false) {
  let ch = csp.chan()
  let fn = lstat ? fs.lstat : fs.stat
  fn(path, (err, stat) => {
    if (err) throw err
    csp.putAsync(ch, stat)
    ch.close()
  })
  return ch
}

// untested and abandoned for now
export function cspDomain(generator, ...args) {
  let ch = csp.chan()
  let d = domain.create()
  d.on('error', (e) => {
    console.log('!!!!!!!!!!!!!!!!!!!ERROR HAPPENED')
    csp.putAsync(ch, {error: e})
    ch.close()
  })
  d.run(() => {
    csp.takeAsync(csp.go(generator, args), (val) => {
      csp.putAsync(ch, {result: val || true})
      ch.close()
    })
  })
  return ch
}

export function cspCopyFile(from, to) {
  let ch = csp.chan()
  fs.createReadStream(from).pipe(
    fs.createWriteStream(to).on('finish', () => ch.close())
  )
  return ch
}

export function cspDownloadAndExtractTarball(url, to) {
  let ch = csp.chan()
  let extractor = tar.Extract({path: to})
    .on('error', (e) => {csp.offer(ch, e)})
    .on('end', () => {
      csp.offer(ch, true)
      ch.close
    })
  request.get(url)
    .on('error', (e) => {csp.offer(ch, e)})
    .pipe(gunzip())
    .on('error', (e) => {csp.offer(ch, e)})
    .pipe(extractor)
  return ch
}

export function cspHttpGet(url) {
  return retryCspStreamFunction(cspyDataStream, [request.get(url)])
}

function retryCspStreamFunction(fn, args, onError, errorArgs) {
  return csp.go(function*() {
    let ret
    let errCount = 0
    while ((ret = yield fn(...args)) instanceof Error) {
      console.log(ret)
      console.log(`Error during ${fn.name} with args ${args}`)
      console.log(`Error count: ${++errCount}`)
      if (typeof onError === 'function') yield onError(...errorArgs)
    }
    if (ret !== null) return ret // we can't return null since it === CSP.CLOSED
  })
}

// TODOP csp_utils should be meant solely for general csp helpers applicable in any project. This
// however is quite vpm-specific

// TODO merge installPath, installDirName
export function installUrl(targetUrl, rootPath, installPath, installDirName) {
  return csp.go(function*() {
    yield cspy(mkdirp, `${rootPath}/tmp_modules`)
    yield cspy(mkdirp, `${rootPath}/${installPath}`)
    // TODOP: use `path` npm module, it
    // TODO leading/trailing slashes in paths and names should be valid and optional
    let tempDir = Math.random().toString(36).substring(8)
    let tempPath = `${rootPath}/tmp_modules/${installDirName}${tempDir}`
    let targetPath = `${rootPath}${installPath}/${installDirName}`
    // TODOP Why? I don't like this blind trying. I don't see any reason why this should fail the
    // first time but not the second.
    // for max. numTries, catch system errors and retry
    const recreateTmpDir = function*() {
      yield cspy(rimraf, tempPath)
      yield cspy(mkdirp, tempPath)
    }
    yield recreateTmpDir()
    yield retryCspStreamFunction(
      cspDownloadAndExtractTarball,
      [targetUrl, tempPath],
      recreateTmpDir
    )
    // tar may have it's content in 'package' subdirectory
    // TODO error handling ?
    // TODOP: Error handling should be easy for now: everything that fails and is not handled
    // otherwise, should resolve into global fail. Remove the TODO, or be more specific in it (what
    // error do you want to handle and how).
    let lsDir = yield cspyData(fs.readdir, tempPath)
    if (lsDir.length === 1 && (yield cspStat(`${tempPath}/${lsDir[0]}`)).isDirectory) {
      yield cspy(fs.rename, `${tempPath}/${lsDir[0]}`, targetPath)
      yield cspy(rimraf, tempPath)
    } else {
      yield cspy(fs.rename, tempPath, targetPath)
    }
  })
}

// returns contents of any stream that emits 'data' and 'end' events as a single string
export function cspyDataStream(stream) {
  let ch = csp.chan()
  let str = []
  stream.on('data', (chunk) => {
    str.push(chunk)
  })
  stream.on('error', (e) => {
    csp.offer(ch, e)
    ch.close()
  })
  stream.on('end', () => {
    csp.offer(ch, str.join(''))
    ch.close()
  })
  return ch
}

export function cspParseFile(path) {
  let readStream = fs.createReadStream(path)
  let ch = csp.chan()
  readStream.on('open', () => {
    csp.operations.pipe(retryCspStreamFunction(cspyDataStream, [readStream]), ch)
  })
  return ch
}

/*
readStream.on('open', () => {
    csp.operations.pipe(cspyDataStream(readStream))
  })
*/

// based on getPackageInfo used in pkg_registry
// returns getter that accepts function returning csp channel
// makes sure up to nrWorkers of these functions are run in parallel
// may pass in a channel and pipe directly to it
export function spawnWorkers(nrWorkers = 6, ch = csp.chan()) {

  function* spawnWorker() {
    while (true) {
      let [fn, resChan] = yield csp.take(ch)
      let ret = yield fn()
      if (ret) yield csp.put(resChan, ret)
      resChan.close()
    }
  }

  for (let i = 0; i < nrWorkers; i++) {
    csp.go(spawnWorker)
  }

  // access function
  return (fn) => {
    return csp.go(function*() {
      // resChan has to have buffer of a size 1 to be peek-able
      let resChan = csp.chan()
      yield csp.put(ch, [fn, resChan])
      return resChan
    })
  }
}
