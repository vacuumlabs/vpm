import {expect} from 'chai'
import 'co-mocha'
import {install} from '../src/main.js'
import {resolveRootNode, mutateIntoConsistent} from '../src/node_registry.js'
import csp from 'js-csp'
import {cspy, cspCopyFile} from '../src/lib/csp_utils'
const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const fs = require('fs')

describe('Main', function() {
  this.timeout(1024000)

  const targetPath = './_test/main'

  beforeEach((done) => {
    csp.takeAsync(csp.go(function*() {
      yield cspy(rimraf, targetPath)
      yield cspy(mkdirp, targetPath)
      //fs.createReadStream('package.json').pipe(fs.createWriteStream(`${targetPath}/package.json`))
    }), () => done())
  })

  it('should install simple peer-dep example', function(done) {
    csp.takeAsync(csp.go(function*() {
      yield cspCopyFile('./_test/firebase.json', `${targetPath}/package.json`)
      yield install(targetPath)
    }), () => done())
  })

/*
  it('should install itself', function(done) {
    csp.takeAsync(csp.go(function*() {
      fs.createReadStream('package.json').pipe(fs.createWriteStream(`${targetPath}/package.json`))
      yield install(targetPath)
    }), () => done())
  })
*/

})
