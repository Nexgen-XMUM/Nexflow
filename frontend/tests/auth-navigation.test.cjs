const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync(require('node:path').join(__dirname,'../login_signup_page.html'),'utf8');
const routeSource=html.match(/function destinationForRole\(role\)\s*\{[\s\S]*?\n   \}/);

test('signup and sign-in continue to the workspace for the selected role',()=>{
  assert.ok(routeSource,'role destination helper exists');
  const destinationForRole=vm.runInNewContext(`(${routeSource[0]})`);
  assert.equal(destinationForRole('owner'),'/app#boss');
  assert.equal(destinationForRole('staff'),'/app#staff');
  assert.equal(destinationForRole('user'),'/app#customer');
  assert.equal(destinationForRole('unknown'),'/app#boss');
});

test('success action and automatic continuation use the same role-specific destination',()=>{
  assert.match(html,/role: selectedSignupRole/);
  assert.match(html,/const destination = destinationForRole\(userData\.role\)/);
  assert.match(html,/\$\('#enterAppBtn'\)\.href = destination/);
  assert.match(html,/setTimeout\(\(\) => window\.location\.assign\(destination\), 900\)/);
});
