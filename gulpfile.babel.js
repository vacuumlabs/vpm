import gulp from 'gulp'
import mocha from 'gulp-mocha'
import babel from 'gulp-babel'
import eslint from 'gulp-eslint'
import 'babel-core/register'
import 'babel-polyfill'

gulp.task('eslint', () => {
  return gulp.src([
    'gulpfile.babel.js',
    'src/**/*.js',
    'test/*.js',
  ])
  .pipe(eslint())
  .pipe(eslint.format())
  .pipe(eslint.failAfterError())
})

gulp.task('test', () => {
  return gulp.src(['test/main_test.js'])
    .pipe(mocha({
      compilers: {js: babel}
    }))
})

module.exports = gulp
