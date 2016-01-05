### Concepts
- package = tarball
- packageName = for example 'immutable'
- packageVersion = '1.2.3' / some semver object?
- packageId = String unique wrp packageName and packageVersion, for example 'immutable@1_2_3'

TODO: What to do with installations from git? Does this change anything?

### What we want
all dependencies are installed in flat node_modules (nm), each package is stored in packageId directory.
If package1 depends on package2, vpm creates `nm/package1Id/nm/package2Name` symlink pointing to
`nm/package2Id`.

### Building blocks worth implementing

I wrote this, because I'm lost in the current architecture. There are already so many functions and yet I
have problem to find the things I'd expect to be there!

`fetch(packageName, version, cacheLocation)`  
downloads the package (tarball); uses the cache.

`installOne(tarball, packageId)`
installs the dependency to the given location. First ungzip & untar it somewhere and then move it to
the desired location so the process is as atomic as possible

`link(id1, id2)`
creates symlink from package id1 to package id2 such that `nm/package1_id/nm/package2_name`
points to package i2

`getDependencies(packageName, version)`
returns list of [packageName, semverRange] elements

`install(packageName, version)`
described later

`registry` - data structure that keep track of what is already installed.

### CSP
- each function that needs to do some asynchronous stuff returns CSP channel with the returning
  value. If the function is called for its (async) side-effects, function returns CSP channel and
  pushes null to it, when the side-effetcs are done.

### Algorithm overview

This describes the `install` function - entrypoint of the algorithm.

    function install (packageName, version) {
      fetch package at the given version and installOne it
      put the information about the package to the registry. This may be important in case of cyclic dependencies
      resolve package dependencies
      for each dependency {
          is dependency in registry (i.e. in the correct version) and does the versions match? {
              link packages
          } else {
              download, link package with the dependency, recursively install depndendencies of
              dependency
          }
      }
    }
       
### Backtracking Peer dependencies
TODO



