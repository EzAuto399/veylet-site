/*
 * Loads dist/site-lib.js (and dist/tour-page.js for the three share pages)
 * into a vm sandbox before the scripts that now use window.VeyletLib. One
 * helper so each test only names the context it already builds.
 */
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const dist = path.join(__dirname, '../dist');
const source = fs.readFileSync(path.join(dist, 'site-lib.js'), 'utf8');
const tourPageSource = fs.readFileSync(path.join(dist, 'tour-page.js'), 'utf8');

const load = sandbox => vm.runInNewContext(source, sandbox);
const loadTourPage = sandbox => vm.runInNewContext(tourPageSource, sandbox);

module.exports = { source, tourPageSource, load, loadTourPage };
