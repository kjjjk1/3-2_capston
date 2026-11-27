/* Keep the persistent bottom tab bar and setup action bar mutually clear. */
document.body.append($('.bottom'));
function iosSync(){const setup=$('#page-find').classList.contains('active');flowActions.hidden=!setup;document.body.classList.toggle('ios-setup',setup);}
const iosSwitch=switchPage;switchPage=function(name){iosSwitch(name);iosSync();};
// Shared appointment snapshots use the legacy rendering entry point.
const iosPlanShow=plannerShow;plannerShow=function(p,received=false){iosPlanShow(p,received);iosSync();};
$('#analysisSave')?.setAttribute('aria-label','이번 이동 기록 저장');
iosSync();
