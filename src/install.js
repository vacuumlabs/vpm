// everything related to installing from solution here
// TODO clean up (so far only functions that survived from wtf.js)
const gunzip = require('gunzip-maybe')
const tar = require('tar-fs')
const fs = require('fs')

// lets encode (package,version) as package@version (any non-URL character can be used as a separator)

function decompress(tarball, path) {
  return tarball => {
    res.pipe(gunzip()).pipe(tar.extract(path))
  }
}

function test() {
  fs.access('./__test__', fs.F_OK, err => {
    if (err) fs.mkdirSync('./__test__')
    rp('http://registry.npmjs.org/babel-core')
      .then(data => installVersionInto(resolveHighestVersion('*', JSON.parse(data)),'./__test__'))
      .catch(dummyError)
  })
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
