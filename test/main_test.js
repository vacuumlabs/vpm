import {expect} from 'chai'
import 'co-mocha'
import {install} from '../src/main.js'
import {enableTestMode} from '../src/node_registry.js'
import csp from 'js-csp'
import {cspy, cspCopyFile} from '../src/lib/csp_utils'
const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const fs = require('fs')

describe('Main', function() {
  this.timeout(1024000)

  const targetPath = './_test/main'

  beforeEach((done) => {
    enableTestMode(false)
    csp.takeAsync(csp.go(function*() {
      yield cspy(rimraf, targetPath)
      yield cspy(mkdirp, targetPath)
    }), () => done())
  })
  it('should install simple peer-dep example', function(done) {
    csp.takeAsync(csp.go(function*() {
      enableTestMode()
      yield cspCopyFile('./test/firebase.json', `${targetPath}/package.json`)
      yield install(targetPath)
    }), () => done())
  })
  /*
  it('should install ied public', function(done) {
    csp.takeAsync(csp.go(function*() {
      enableTestMode()
      yield cspCopyFile('./package.json', `${targetPath}/package.json`)
      yield install(targetPath)
    }), () => done())
  })
  */
  /*
  it('should try install itself with public', function(done) {
    csp.takeAsync(csp.go(function*() {
      enableTestMode()
      yield cspCopyFile('./package.json', `${targetPath}/package.json`)
      yield install(targetPath)
    }), () => done())
  })
  it('should try install wordy with public', function(done) {
    csp.takeAsync(csp.go(function*() {
      enableTestMode()
      yield cspCopyFile('./test/wordy.json', `${targetPath}/package.json`)
      yield install(targetPath)
    }), () => done())
  })
  it('should install wordy - use npm 3.3.12 to compare', function(done) {
    csp.takeAsync(csp.go(function*() {
      yield cspCopyFile('./test/wordy.json', `${targetPath}/package.json`)
      yield install(targetPath)
    }), () => done())
  })
/*

  it('should install itself', function(done) {
    csp.takeAsync(csp.go(function*() {
      yield cspCopyFile('./package.json', `${targetPath}/package.json`)
      //fs.createReadStream('package.json').pipe(fs.createWriteStream(`${targetPath}/package.json`))
      yield install(targetPath)
    }), () => done())
  })
*/
})
