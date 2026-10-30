'use strict';
const {Policy,LIMITS,CODES,REDACTED,BUILTINS}=require('../dist/infrastructure/privacy/matcher-core.cjs');
function contracts(){
  const rows=[],nativeTest=RegExp.prototype.test,nativeExec=RegExp.prototype.exec;
  const cases=[
    ['ascii-i',/error|warn/i,'WARN'],['negative',/error|warn/i,'ordinary'],['literal-space',/private value/i,'PRIVATE VALUE'],
    ['global',/token/g,'token'],['sticky-match',/token/y,'token'],['sticky-miss',/token/y,'x token'],
    ['multiline-lf',/^token$/m,'x\ntoken\ny'],['dotall',/a.b/s,'a\nb'],['dot-cr',/^a.b$/,'a\rb'],
    ['dot-ls',/^a.b$/u,'a\u2028b'],['nonunicode-astral-dot',/^.$/,'\ud83d\ude00',CODES.input],
    ['unicode-astral-dot',/^.$/u,'\ud83d\ude00'],['unicode-literal',/\u{1f600}/u,'\ud83d\ude00'],
    ['space-nbsp',/\s+/,'\u00a0'],['space-bom',/\s+/,'\ufeff'],['nonspace-nbsp',/\S+/,'\u00a0'],
    ['space-class',/[\s@]+/,'\u00a0'],['negated-space-class',/[^\s@]+/,'\u00a0'],
    ['bearer-nbsp',/Bearer\s+[A-Za-z0-9\-._~+\/=]*/i,'Bearer\u00a0synthetic'],
    ['bearer-bom',/Bearer\s+[A-Za-z0-9\-._~+\/=]*/i,'Bearer\ufeffsynthetic'],
    ['basic-nbsp',/Basic\s+[A-Za-z0-9+\/=]*/i,'Basic\u00a0c3ludGhldGlj'],
    ['nonunicode-i-kelvin',/k/i,'\u212a'],['unicode-i-kelvin',/k/iu,'\u212a'],
    ['nonunicode-i-long-s',/s/i,'\u017f'],['unicode-i-long-s',/s/iu,'\u017f'],
    ['nonunicode-negation-case',/[^k]/i,'\u212a'],['unicode-word-fold',/\w+/iu,'\u212a'],
    ['unicode-fold-boundary',/\b\w+\b/iu,'\u212a',CODES.syntax],
    ['nonunicode-literal-emoji-input',/token/i,'\ud83d\ude00 token'],
    ['multiline-cr',/^token$/m,'x\rtoken\ry',CODES.input],
    ['multiline-ls',/^token$/m,'x\u2028token\u2028y',CODES.input],
    ['property',/\p{Letter}+/u,'letters',CODES.syntax],['unicode-nonascii-fold',/\u00e9/iu,'\u00c9',CODES.syntax],
    ['lookahead',/token(?==)/,'token=synthetic',CODES.syntax],['lookbehind',/(?<=a)b/,'ab',CODES.syntax],
    ['backref',/(ab)\1/,'abab',CODES.syntax],['lone-surrogate',/./u,'\ud800',CODES.input],
    ['end-final-lf',/token$/,'token\n'],['empty-astral-nonu',/(?:)/g,'\ud83d\ude00',CODES.input],
    ['email',/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,'person@example.test'],
    ['url',/\b[a-z][a-z0-9+.-]*:\/\/[^\s@]+@/i,'https://person:synthetic@example.test'],
    ['indices-flag',new RegExp('token','d'),'token'],
    ['nested-repeat-budget',/(?:a{1000}){1000}/,'a',CODES.budget],
  ];
  try{cases.push(['unicode-sets',new RegExp('[a&&b]','v'),'a',CODES.syntax]);}catch{}
  for(const [id,pattern,text,rejection]of cases){
    pattern.lastIndex=0;const expected=nativeTest.call(pattern,text);pattern.lastIndex=17;
    const codes=[],policy=new Policy({sensitive:[pattern],onDiagnostic:code=>codes.push(code)}),call=policy.begin();
    let nativeInputCalls=0;
    RegExp.prototype.test=function(input){if(input===text)nativeInputCalls++;return nativeTest.call(this,input);};
    RegExp.prototype.exec=function(input){if(input===text)nativeInputCalls++;return nativeExec.call(this,input);};
    let actual;try{actual=policy.privacy(text,call);}finally{RegExp.prototype.test=nativeTest;RegExp.prototype.exec=nativeExec;}
    const status=rejection?(actual===true&&codes.includes(rejection)?'EXPECTED_FAIL_CLOSED':'FAIL'):(actual===expected&&!call.failed?'MATCHES_NATIVE':'FAIL');
    rows.push({id,status,expected,actual,codes,nativeInputCalls,callerPatternUnchanged:pattern.lastIndex===17});call.close();policy.close();
  }
  const replacements=[
    ['capture-global',/(secret)=(\w+)/g,'secret=one secret=two','$1=[REDACTED]'],
    ['capture-first',/(secret)=(\w+)/,'secret=one secret=two','$1=[REDACTED]'],
    ['repeated-captures',/(?:(a)|(b)|(c))+/g,'abc','$1:$2:$3',CODES.replace],
    ['named',/(?<key>secret)=(\w+)/g,'secret=one','$<key>=[REDACTED]'],
    ['named-missing',/(?<key>secret)/g,'secret','$<absent>'],
    ['dollar-specials',/b/g,'abc','$$:$&:$`:$\''],
    ['digits',/(a)(b)?/g,'a ab','$01:$10:$2:$0:$99'],
    ['empty',/(?:)/g,'ab','_'],['empty-unicode',/(?:)/gu,'\ud83d\ude00','_'],
    ['normal-unicode-offset',/secret/gu,'\ud83d\ude00secret secret','[REDACTED]'],
    ['callback',/secret/gu,'\ud83d\ude00secret',()=>{throw new Error('MUST_NOT_INVOKE');},CODES.replace],
    ['sticky',/token/y,'token','masked',CODES.replace],
    ['match-budget',/a/g,'a'.repeat(256),'masked',CODES.output],
  ];
  for(const [id,pattern,text,replacement,rejection]of replacements){
    const expected=rejection?null:text.replace(pattern,replacement);
    const codes=[],policy=new Policy({sensitive:[pattern],onDiagnostic:code=>codes.push(code)}),call=policy.begin();
    const actual=policy.replace(0,text,replacement,call);
    rows.push({id:'replace-'+id,status:rejection?(actual===REDACTED&&codes.includes(rejection)?'EXPECTED_FAIL_CLOSED':'FAIL'):(actual===expected&&!call.failed?'MATCHES_NATIVE':'FAIL'),codes,actualLength:actual.length,expectedLength:expected?.length});call.close();policy.close();
  }
  const invalid=[/((a{1000}){1000})/,new RegExp('a'.repeat(257)),new RegExp('('.repeat(20)+'a'+')'.repeat(20)),/(?=SYNTHETIC_INLINE_CREDENTIAL_4821)x/];
  for(let i=0;i<invalid.length;i++){
    const codes=[],policy=new Policy({sensitive:[invalid[i]],selectors:[invalid[i]],onDiagnostic:code=>codes.push(code)});
    const p=policy.begin(),s=policy.begin();const privacy=policy.privacy('ordinary',p),selector=policy.include('ordinary',s);
    rows.push({id:'invalid-policy-'+i,status:privacy&&!selector&&policy.stats.engineCompiles===0&&codes.every(code=>Object.values(CODES).includes(code))?'EXPECTED_FAIL_CLOSED':'FAIL',codes,engineCompiles:policy.stats.engineCompiles});p.close();s.close();policy.close();
  }
  for(const [id,options]of [['count',{sensitive:Array.from({length:33},()=>/token/)}],['total',{sensitive:Array.from({length:32},()=>/a{128}/),selectors:Array.from({length:32},()=>/b{128}/)}]]){
    const codes=[],policy=new Policy({...options,onDiagnostic:code=>codes.push(code)});const call=policy.begin();
    rows.push({id:'compile-budget-'+id,status:policy.stats.engineCompiles===0&&policy.privacy('ordinary',call)&&codes.includes(CODES.budget)?'EXPECTED_FAIL_CLOSED':'FAIL',codes,engineCompiles:policy.stats.engineCompiles});call.close();policy.close();
  }
  const p=new Policy({sensitive:[/token/]}),c=p.begin();p.close();rows.push({id:'closed-policy',status:p.privacy('ordinary',c)&&!p.include('ordinary',c)?'EXPECTED_FAIL_CLOSED':'FAIL'});c.close();
  const q=new Policy({sensitive:[/x/],selectors:[/x/]}),d=q.begin();q.privacy('a'.repeat(LIMITS.inputPerRule+1),d);rows.push({id:'input-budget',status:d.failed&&q.privacy('ordinary',d)&&!q.include('ordinary',d)?'EXPECTED_FAIL_CLOSED':'FAIL'});d.close();q.close();
  const defaults=new Policy({sensitive:[/password/i,/token/i,/secret/i,/api[_-]?key/i,/authorization/i,/credit[_-]?card/i,/ssn/i,/cpf/i],builtins:BUILTINS});
  const codesBefore=[...defaults.diagnostics];const dc=defaults.begin();const mask=defaults.privacy('Bearer\u00a0synthetic',dc);rows.push({id:'normal-builtins-default-policy',status:mask&&!dc.failed&&codesBefore.length===0?'MATCHES_NATIVE':'FAIL',codes:[...defaults.diagnostics],stats:defaults.stats});dc.close();defaults.close();
  const off=new Policy({sanitize:false,sensitive:[/(?=private)/],selectors:[/include/i]}),oc=off.begin();rows.push({id:'explicit-sanitize-false',status:!off.privacy('private',oc)&&off.include('include',oc)&&off.replace(0,'private','mask',oc)==='private'&&off.diagnostics.size===0&&off.roles.sensitive.length===0?'MATCHES_NATIVE':'FAIL'});oc.close();off.close();
  const noisy=new Policy({sensitive:[/(?=SYNTHETIC_INLINE_CREDENTIAL_4821)x/],onDiagnostic:()=>{throw new Error('MUST_NOT_ESCAPE');}}),nc=noisy.begin();rows.push({id:'diagnostic-callback-throws',status:noisy.privacy('ordinary',nc)&&!noisy.include('ordinary',nc)?'EXPECTED_FAIL_CLOSED':'FAIL'});nc.close();noisy.close();
  const hidden=new Policy({sensitive:[/SYNTHETIC_INLINE_CREDENTIAL_4821/]}),hc=hidden.begin();hidden.privacy('SYNTHETIC_RECORD_VALUE_7731',hc);
  const serialized=JSON.stringify({hidden,hc})+require('node:util').inspect({hidden,hc});rows.push({id:'diagnostic-serialization',status:!serialized.includes('SYNTHETIC_INLINE_CREDENTIAL_4821')&&!serialized.includes('SYNTHETIC_RECORD_VALUE_7731')?'MATCHES_NATIVE':'FAIL'});hc.close();hidden.close();
  const graph=new Policy({sensitive:[/password/i,/token/i,/secret/i,/api[_-]?key/i,/authorization/i,/credit[_-]?card/i,/ssn/i,/cpf/i],builtins:BUILTINS}),gc=graph.begin();let falseMasks=0;for(let i=0;i<500;i++)falseMasks+=graph.privacy('field'+i,gc)?1:0;rows.push({id:'default500-scalar-envelope',status:falseMasks===0&&!gc.failed?'MATCHES_NATIVE':'FAIL',falseMasks,call:gc.summary()});gc.close();graph.close();
  return {rows,counts:{total:rows.length,pass:rows.filter(row=>row.status==='MATCHES_NATIVE').length,failClosed:rows.filter(row=>row.status==='EXPECTED_FAIL_CLOSED').length,fail:rows.filter(row=>row.status==='FAIL').length},scope:'Portable major matcher subset: explicit fail-closed exclusions are not native equivalence; not whole-application performance qualification.'};
}
module.exports={contracts};
if(require.main===module)console.log(JSON.stringify(contracts(),null,2));

