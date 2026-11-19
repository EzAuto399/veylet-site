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
const planTermsSource = fs.readFileSync(path.join(dist, 'plan-terms.js'), 'utf8');

// Pages load site-lib.js and plan-terms.js before their desk scripts.
const load = sandbox => { vm.runInNewContext(source, sandbox); vm.runInNewContext(planTermsSource, sandbox); };
const loadTourPage = sandbox => vm.runInNewContext(tourPageSource, sandbox);

module.exports = { source, tourPageSource, planTermsSource, load, loadTourPage };
