'use strict';
const utils = require('./utils.js')
const semver = require('semver')
const rp = require('request-promise')

// TODO - is this an OK practice ? (if I want a variable exposed to all top-level functions and not to worry about passing it around)
let packageMap

// factory functions

const PackageMap = _ => {
  let packages = new Map()
  const append = dependencyMap => {
    for (let entry of dependencyMap) {
      if (!packages.has(entry[0])) {
        // TODO we could cut off some of the possible dependencies based on version range
        // from entry[1], ommited for now in favor of simplicity
        packages.set(entry[0], PackageNode(entry[0]))
      }
    }
    return packages
  }
  return {
    packages,
    append
  }
}

const DependencyGraph = (packageJSON) => {
  return {
    packageMap: packageMap,
    requiredPackages: packageMap.append(utils.toMap(packageJSON.dependencies))
  }
}

// from dependencies perspective, each package node is a disjunction
// (between dependency nodes) of conjunctions (packages listed in each dep. node)
const PackageNode = (name) => {
  let dependencyNodes = []
  rp(`http://registry.npmjs.org/${name}`)
    .then(data => {
      let versions = utils.toMap(
        utils.toArray(JSON.parse(data).versions)
          .map( data => [data[0],utils.toMap(data[1].dependencies)])
          //.filter( data => semver.satisfies(data[0],semverRange))
      )
      for (let depVersionAndMap of iterateDependencyChanges(versions)) {
        dependencyNodes.push(DependencyNode(name, ...depVersionAndMap))
        //state.versions.push(depVersionAndMap[0])
      }
    })
  return {
    name,
    dependencyNodes
  }
}

const DependencyNode = (name, semverRange, dependencies) => {
  packageMap.append(dependencies)
  return {
    name,
    semverRange,
    dependencies
  }
}

// functions

const sortedDependenciesString = (dependencies) => {
  return JSON.stringify([...dependencies].sort((x,y) => {x[0].localeCompare(y[0])}))
}

// TODO error handling
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

packageMap = PackageMap()

module.exports = {
  DependencyGraph: DependencyGraph
}
