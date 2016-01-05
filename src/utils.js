//TODO get rid of this file.
//1) I commited useful.js from wordy here - if you need anything which is not there, feel free to
//add it there.
//2) you are doing a lot of nasty and unnecessary side-effects on Object, Map, etc. Why not simply
//export functions you need?
Object.entries = function* entries(obj) {
   for (let key of Object.keys(obj)) {
     yield [key, obj[key]]
   }
}

Object.toArray = (obj) => {
  let arr = []
  for (let key of Object.keys(obj)) {
     arr.push([key, obj[key]])
  }
  return arr
}

Map.fromObject = (obj) => {
  return new Map(Object.entries(obj))
}

function dummyError(e) {
  if (e)
    console.log(e)
  else
    console.log('TODO error handling')
}

module.exports = {
  dummyError: dummyError
}
