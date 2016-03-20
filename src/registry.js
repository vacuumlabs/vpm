import csp from 'js-csp'
import {getPackageInfo} from './csp_utils.js'
import {flattenShallow} from './useful.js'
import Queue from 'fastqueue'
import t from 'transducers.js'

let {map,filter} = t

const queue = new Queue
const registry = {}
const waiting = [] // channels of packages waiting to be fetched
const getter = getPackageInfo(registry, 20)

const available

function getAllDependencies(pkg) {
  return csp.go(function*() {
    queue.push(pkg)
    while (true) {
      if (queue.length === 0) {
        break
      }
      let pkg = queue.shift()
      console.log('start', pkg)
      let pkgInfo = yield csp.take(getter(pkg))
      console.log('end', pkg)

      let tbd = {}
      if ('versions' in pkgInfo) {
        for (let ver in pkgInfo.versions) {
          let verData = pkgInfo.versions[ver]
          if ('dependencies' in verData) {
            for (let dep in verData.dependencies) {
              tbd[dep] = true
            }
          }
        }
      }
      for (let dep in tbd) {
        if (registry[dep] === undefined) {
          queue.push(dep)
          getter(dependencies)
        }
      }
    }
    return null
  })
}

csp.go(function*() {
  yield csp.take(getAllDependencies('eslint'))
})


//todo create fake _ROOT_ package
function main() {
  let deps = ['eslint', 'babel-core'] // only for testing
  waiting = map(deps, pkg => getter(pkg))
  while (true) { // todo
    let pkg = yield csp.alts(waiting)
  }
}

function createNode(requiredSemver, pkgName, pubDepRequirements) {
  return csp.go(function*() {
    let pkgJson = getter(pkgName)
    // get best version (locally/globally?)
    let versionSemver = '0.0.0' // todo transform required semver to one locked to dependencies
    let versionPackage = null //todo
    let resolvedNodes = new Set()
    let satisfiesPublic = new Map()
    if ('dependencies' in versionPackage) { //todo
      // map packageName => channel, alts channels and throw away resolved ones until all are done
      //TODO set should be enough, we don't need values
      let getterChannels = new Set(map(versionPackage.dependencies.keys, pkgName => getter(pkgName))) //.keys ?
      let nodeChannels = []
      while (getterChannels.size) {
        let [ch, pkg] = yield csp.alts(Array.from(getterChannels))
        getterChannels.delete(ch)
        //TODO change here - make breadth first (two steps - resolve public deps first, then go deeper)
        nodeChannels.push(createNode(versionPackage.dependencies[pkg.name], pkg.name))
      }
      //TODO make this in parallel ?
      // wait until nodes for all dependencies are created
      resolvedNodes = new Set(cspAll(nodeChannels))
      //TODO handle public dependencies somewhere aroundhere
    }
    return nodeFactory()
  })
}

//TODO we need extra semver functionality (union, intersect)
function iterateVersions(requiredSemver, availableVersions) {
  //returns meaningfull versions - starting with those already installed, then highest available,
  //then highest one before dependency change
  //for now, just get the highest one
}

function nodeFactory(name, semver, dependentNodeSet, public = false) {
  return {
    name: name,
    semver: semver,
    dependentNodeSet: dependentNodeSet,
    installed: false
  }
}

function getHighestSatDependencies(pkg) {

}

function constructRegistry(mainPkgs) {

}
