'use strict';
const utils = require('./utils.js')
const semver = require('semver')
const rp = require('request-promise')

// TODO - is this an OK practice ? (if I want a variable exposed to all top-level functions and not to worry about passing it around)
let packageMap = new Map()
let promiseMap = new Map()

// factory functions

const PackageMap = () => {
  return {
    getPromise: (name) => {
      return new Promise((resolve, reject) => {
        if (packageMap.has(name)) {
          let packageNode = packageNodeMap.get(name)
          if (packageNode.resolved) {
            resolve(packageNode)
          } else {
            packageNode.resolved = true
            packageNode.resolve().then(_ => resolve(packageNode))
          }
        } else {
          reject(undefined)
        }
      })
    }
  }
}

const DependencyGraph = (packages) => {
  return {
    packageMap: PackageMap(),
    requiredSet: packages
  }
}

// each package node is essentialy a disjunction (between dependency nodes) of conjunctions (packages listed in each dep. node)
const PackageNode = (name, versions) => {
  dependencyNodes = []
  for (let semverAndDepArray of iterateDependencyChanges(versions)) {
    dependencyNodes.push(DependencyNode(name, ...semverAndDepArray))
  }
  let obj = {
    name,
    dependencyNodes,
    resolved: false, // TODO set this from within resolve function ?
    resolve: resolveDependencyNodes(dependencyNodes)
  }
  packageMap.set(name, obj)
  return obj
}

const DependencyNode = (name, semverRange, dependencyArray) => {
 return {
    name,
    semverRange,
    dependencyArray,
    resolve: dependenciesToPackageNodes(dependencyArray) // TODO add resolved ?
  }
}

// promise factories

const promisePackageNode = (name) => {
  if (promiseMap.has(name)) return promiseMap.get(name)
  let promise = new Promise((resolve, reject) => {
    rp(`http://registry.npmjs.org/${name}`)
      .then(data => {
        if (packageMap.packages.has(name)) resolve(false) //if by the time callback is called we already have the package..
        let dependencyNodes = []
        let versions = utils.toMap(
          utils.toArray(JSON.parse(data).versions)
            .map( data => [data[0],utils.toMap(data[1].dependencies)])
            //.filter( data => semver.satisfies(data[0],semverRange))
        )
        resolve(PackageNode(name,versions))
      })
  })
  promiseMap.set(name,promise)
  return promise
}

const promiseDependencyGraph = (packageJSON) => {
  return new Promise((resolve, reject) => {
    dependenciesToPackageNodes(packageJSON.dependencies)
      .then( packages => resolve(DependencyGraph(packages)))
  })
}

// functions

const resolveDependencyNodes = (dependencyNodes) => {
  return () => {
    return new Promise((resolve, reject) => {
      Promise.all(
        dependencyNodes.map( node => {
          node.resolve()
        })
      ).then(arraysOfPackageNodes => {
        resolve(new Set(utils.flattenArray(arraysOfPackageNodes)))
      })
    })
  }
}

const dependenciesToPackageNodes = (dependencyArray) => {
  return () => {
    return new Promise((resolve, reject) => {
      Promise.all(
        dependencyArray.map(dep => {
          promisePackageNode(dep[0])
        })
      ).then(packageNodes => resolve(packageNodes))
    })
  }
}

const sortedDependenciesString = (dependencies) => {
  return JSON.stringify([...dependencies].sort((x,y) => {x[0].localeCompare(y[0])}))
}

function* iterateDependencyChanges(versions) {
  let minVersion = versions.keys().next().value
  let minVersionDependencies = sortedDependenciesString(versions.values().next().value)
  for (let entry of versions) {
    let versionDependencies = sortedDependenciesString(entry[1])
    if ( minVersionDependencies !== versionDependencies ) {
      yield [`>=${minVersion} <${entry[0]}`, JSON.parse(minVersionDependencies)]
      minVersion = entry[0]
      minVersionDependencies = versionDependencies
    }
  }
  yield [`>=${minVersion}`, JSON.parse(minVersionDependencies)]
}

module.exports = {
  promiseDependencyGraph: DependencyGraph
}
