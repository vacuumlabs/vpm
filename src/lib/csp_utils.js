import csp from 'js-csp'
import {cloneDeep} from 'lodash'
const fs = require('fs')
const domain = require('domain')
const request = require('request')
const tar = require('tar')
const gunzip = require('gunzip-maybe')

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

// this kind-of works, untested and abandoned for now
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

// based on getPackageInfo used in pkg_registry
// returns getter that accepts function returning csp channel
// makes sure up to nrWorkers of these functions are run in parallel
// may pass in a channel and pipe directly to it
export function spawnWorkers(nrWorkers = 20, ch = csp.chan()) {

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
