// TODO use imports instead of requires (throughout the project. index.js is the only place, where
// requires are necessary). For example:
// import * as utils from './utils.js'

const utils = require('./utils.js')
const semver = require('semver')
const rp = require('request-promise')

// factory functions
// TODO: Let's not use es6 Maps, they suck.
// if possible, stick with std js Objects. If not possibl (for example, you need your keys to be
// something else than just strings, please use immutable.js . If there is really, really good
// reason for using the es6 Maps, let's discuss it then.

let packageMap = new Map()

const DependencyGraph = (packageJSON) => {
  console.log(packageJSON)
  let state = {
    packageMap,
    requiredPackages: mapNewDependencies(packageJSON)
  }
  return Object.assign(
    {},
    state
  )
}

const PackageNode = (name, semverRange = '*') => {
  let state = {
    name,
    dependencyNodes: mapDependencyNodes(name, semverRange),
    satisfied: false
  }
  console.log(`PACKAGE ${name}`)
  return Object.assign(
    {},
    state
  )
}

const DependencyNode = (name, semverRange, dependencies) => {
  let state = {
    name,
    semverRange,
    dependencies
  }
  console.log(`dependency ${name}`)
  return Object.assign(
    {},
    state
  )
}

// functions

const mapNewDependencies = (packageJSON) => {
  return new Map(
    Object.toArray(packageJSON.dependencies).map((i) => {
      if (!packageMap.has(i[0])) packageMap.set(i[0],PackageNode(i[0],i[1]))
      return [i[0], packageMap[i[0]]]
    })
  )
}

const mapDependencyNodes = (name, semverRange = '*') => {
  let dependencyNodes = []
  rp(`http://registry.npmjs.org/${name}`)
    .then(data => {
      // TODO HERE VERSIONS
      let versions = Object.toArray(JSON.parse(data).versions).map( data => {
        console.log(data[1].dependencies)
        return [data[0],data[1].dependencies]
      }).filter( data => semver.satisfies(data[0],semverRange))
      for (let depVersionAndMap of iterateDependencyChanges(versions)) {
        dependencyNodes.push(DependencyNode(name, ...depVersionAndMap))
      }
    })
  return dependencyNodes
}

const sortedDependenciesString = (packageJSON) => {
  console.log(packageJSON)
  return JSON.stringify(Object.toArray(packageJSON.dependencies).sort((x,y) => {x[0].localeCompare(y[0])}))
}

// TODO (by Pinto) error handling
// TODO why is this a generator? Do we need the laziness? If there is no serious reason for it,
// please make it return some standard data structure
function* iterateDependencyChanges() {
  let minVersionIndex = 0
  let minVersionDependencies = sortedDependenciesString(versions[minVersionIndex])
  for (let key of versions) {
    let versionDependencies = sortedDependenciesString(versions[key])
    if ( minVersionDependencies !== versionDependencies ) {
      yield [`>=${versions[minVersionIndex]} <${key}`, mapNewDependencies(versions[key])]
      minVersionIndex = i
      minVersionDependencies = versionDependencies
    }
  }
  yield [`>=${versions[minVersionIndex]}`]
}

// TODO: use es6 exports
module.exports = {
  DependencyGraph: DependencyGraph
}
