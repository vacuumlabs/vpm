## Concepts
- package = package name such as 'immutable'
- version = '1.2.3' 
- version range = version interval as semver understands it

TODO: What to do with installations from git? Does this change anything?

## Directory structure
all dependencies are installed in flat node_modules/.stuff/package@version structure. Vpm then use
symlinks to wire this up.

#### Sample structure of `node_modules` directory

    nm/.stuff/package1@version
             /package2@version
       package1 -> .stuff/package1@version
       package2 -> .sutff/package2@version

#### Sample structure of `.stuff` directory

    ./stuff/package1@version/nm/package3 -> ../../../package3@version
                               /package4 -> ../../../package4@version

           /package2@version/nm/...

## Some important functions


#### Registry 

registry works as a cache for information obtained from `https://registry.npmjs.org/packagename`.
It's structure is such as:

    registry: {
      package: {
        version: {
          tarball: url_string,
          dependencies: {
            name: version_string
          }
        }
      }
    }

#### Solution

represents what should be installed and how the things should be linked. Information in the solution
is approx. the same as contained in npm-shrinkwrap.

    solution: {(package, version) | 'root' : [(package1, version), (package2, version), ...]}

TODO: how to encode the (package, version) tuple?

#### Resolve
resolve(dedepndencies, registry): solution

Finds the solution. May use fetchPackageInfo to get the information necessary. Uses `registry` as a
cache for this information (the `registry` object is mutated as `resolve` advances.

#### fetchPackageInfo(package)
downloads info from `registry.npmjs.org`


#### fetch(package, version, cache)
downloads the package (tarball); uses the cache.

#### installOne(tarball, packageId)
installs the dependency to the given location. First ungzip & untar it somewhere and then move it to
the desired location so the process is as atomic as possible. TODO: use npm for this?

#### link(package1, version1, package2, version2)
Links package1 and package2: 

`nm/.stuff/package1@version1/nm/package2` points to `nm/.stuff/package2@version2`. 

If `package1 = 'root'`, creates symlink

`nm/package2` which points to `nm/.stuff/package2@version2`

## CSP
- each function that needs to do some asynchronous stuff returns CSP channel with the returning
  value. If the function is called for its (async) side-effects, function returns CSP channel and
  pushes null to it, when the side-effetcs are done.

## Resolve algorithm overview
For now on, keep greedily installing anything that is necessary. Don't do installs that are not
necessary (i.e. dependency is already satisfied)

## Testing
- test `resolve` on synthetic data (mock registry such that `resolve` won't call 
- test 'the whole thing' on real packages
       
## Backtracking Peer dependencies
TODO



