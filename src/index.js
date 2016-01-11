// purpose of this file is just to require babel-polyfill, babel-core/register
// and then pass the controll to the 'main module' - for now, some demo, I suppose.
require('babel-polyfill')
require('babel-core/register')()
// at the moment this points to whichever file is currently tested
require('./registry.js')
