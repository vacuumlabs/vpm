'use strict';
const rp = require('request-promise')
const request = require('request')
const semver = require('semver')
const gunzip = require('gunzip-maybe')
const tar = require('tar-fs')
const fs = require('fs')

const dg = require('./dependency_graph.js')

let installList = new Map();

// temporal, only until more 'intelligent' install will be done
function resolveHighestVersion(semverRange, packageJSON) {
  let resolved = packageJSON.versions[semver.maxSatisfying(Object.keys(packageJSON.versions), semverRange)]
  if (!resolved) throw new Error('no satisfying target found for '+ packageJSON._id + '@' + semverRange)
  return resolved 
}

function installVersionInto(versionJSON,path) {
  request(versionJSON.dist.tarball)
    .pipe(gunzip())
    .pipe(tar.extract(
      path, {
        map: header => {
          header.name = header.name.split('/').slice(1).join('/')
          return header
        }
      }))
    .on('error',(err) => {throw err})
}

function decompress(tarball, path) {
  return tarball => {
    res.pipe(gunzip()).pipe(tar.extract(path))
  }
}

function dummyPrint(data) {
	console.log(data)
}

function dummyError(e) {
  if (e) 
    console.log(e)
  else
    console.log('TODO error handling')
}

function test() {
  fs.access('./test_dir', fs.F_OK, err => {
    if (err) fs.mkdirSync('./test_dir')
    rp('http://registry.npmjs.org/babel-core')
      .then(data => installVersionInto(resolveHighestVersion('*', JSON.parse(data)),'./test_dir'))
      .catch(dummyError)
  })  
}

function testmoar() {
  console.log('This is the other test')
  rp('http://registry.npmjs.org/babel-core')
      .then(data => {
        let graph = dg.DependencyGraph(resolveHighestVersion('*', JSON.parse(data)))
        console.log(graph.packages)
      })
}

module.exports = {
  test: testmoar
}

/*

function parseResponseAndCall(success_function, ...args) {
  return response => {
    let raw = ''
    response.on('data', chunk => { 
      raw += chunk 
    })
    response.on('end', () => {
      success_function(raw, ...args)
    })
    success_function(raw,...args)
  }
}


function something(data) {
  const parsed = JSON.parse(data)
  for (let key in parsed.versions) {
    console.log(key)
    for (let key in parsed.versions) {
      console.log(parsed.versions[key].dependencies)
    }
    console.log('-------')
  }
}
*/