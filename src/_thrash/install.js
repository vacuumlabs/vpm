// everything related to installing from solution here
// TODO rename/change functions according to design.md
import {mkdirp} from 'mkdirp'
import tarball from 'tarball-extract'
import csp from 'js-csp'
import t from 'transducers.js'
import cspu from './csp_utils.js'
import {rimraf} from 'rimraf'
import {getPackageInfo} from './registry.js'
import {getSolution} from './solution.js'

// transducers
const installKeys = t.map(kv => install(kv[0]))
const filterErrors = t.filter(e => e !== csp.CLOSED)
const extractKeys = t.map(kv => kv[0])

// constructed during install
let registry = {}
let solution = {}

export function install(dependencies) {

}

export function __install(dependencies) {
  return csp.go(function*(){
    console.log('Creating registry')
    //registry = yield registryChannel(t.toArray(dependencies, extractKeys))
    console.log('Constructing solution')
    solution = getSolution(dependencies,registry)
    console.log('Resolving solution')
    if (yield createDirectories() !== csp.CLOSED) console.log('Error while creating directories.')
    if (yield fetchPackages() !== csp.CLOSED) console.log('Error while downloading/extracting packages.')
    if (yield createSymlinks() !== csp.CLOSED) console.log('Error while creating symlinks.')
    console.log('Done.')
  })
}

function fetchPackages() {
  return csp.go(function*(){
    // run install on every key from solution, return array of errors yielded from channels
    let errors = seq(yield csp.take(cspAll(t.toArray(solution, installKeys))), filterErrors)
    //TODO nicer error handling
    if (yield cspu.cspy(rimraf,'./_tmp') !== csp.CLOSED) console.log('Error while creating directories')
    if (errors.length > 0) {
      console.log(errors)
      return errors
    }
  })
}

function _install(solutionKey) {
  return yield csp.go(function*(){
    let pkgVerTuple = solutionKey.split(1)
    cspu.cspy(
      tarball.extractTarballDownload,
      registry[pkgVerTuple[0]][pkgVerTuple[1]].tarball,
      `./_tmp/${solutionKey}.tar`,
      `./nm/.stuff/${solutionKey}`
    )
  })
}

function createDirectories() {
  return yield csp.go(function*(){

    function createDir(path) {
      //TODO nicer error handling
      if (yield cspu.cspy(mkdirp,path) !== csp.CLOSED) {
        console.log(`error creating directory ${path}`)
      }
    }

    // create all necessary dirs for both install and symlink functions
    for pkg in solution {
      if (pkg==='root') {
        // create directories of direct dependencies (later linked with their counterparts in .stuff)
        for dep of solution[pkg] {
          let depVerTuple = dep.split(1)
          createDir(`./nm/${depVerTuple[0]}`)
        }
      } else {
        createDir(`./nm/.stuff/${pkg}`)
        for dep of solution[pkg] {
          let depVerTuple = dep.split(1)
          createDir(`./nm/.stuff/${pkg}/${depVerTuple[0]}`)
        }
      }
  })
}

function constructSymlinks() {
  return yield csp.go(function*(){

    function createSymlink(origin,target) {
      //TODO nicer error handling
      if cspu.cspy(fs.symlink,origin,target) !== csp.CLOSED) {
        console.log(`error creating directory ${path}`)
      }
    }

    for pkg in solution {
      if (pkg==='root') {
        // create symlinks for direct dependencies into .stuff directory
        for dep of solution[pkg] {
          let depVerTuple = dep.split(1)
          createSymlink(`./nm/${depVerTuple[0]}`,`./nm/.stuff/${dep}`)
        }
      } else {
        let pkgVerTuple = solutionKey.split(1)
        for dep of solution[pkg] {
          let depVerTuple = dep.split(1)
          createSymlink(`./nm/.stuff/${pkg}/${depVerTuple[0]}`,`./nm/.stuff/${dep}`)
        }
      }
    }
  })
}
