#!/bin/sh
# Cache-busting: stamp every local asset URL with a new version so browsers
# fetch fresh files after each deploy. Run before committing a change.
cd "$(dirname "$0")/.." || exit 1
v=$(date +%Y%m%d%H%M)
sed -i '' -E "s/(href=\"styles\.css|src=\"app\.js)(\?v=[0-9]+)?\"/\1?v=$v\"/" index.html
sed -i '' -E "s#from '\./(api|config|image)\.js(\?v=[0-9]+)?'#from './\1.js?v=$v'#" app.js api.js
sed -i '' -E "s#import\('\./(api|demo)\.js(\?v=[0-9]+)?'\)#import('./\1.js?v=$v')#g" app.js
echo "assets stamped v=$v"
