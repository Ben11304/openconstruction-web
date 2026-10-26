
  (function(){
    var api = window.OpenConstructionInstitutions;
    var marquee = document.getElementById('indexInstitutionMarquee');
    if (!api || !marquee) return;
    api.renderInstitutionMarquee({
      target: marquee,
      url: 'data/institutions.json',
      speed: 46
    }).then(function(result){
      var el = document.getElementById('institutionCount');
      if (el && result && result.count) {
        var rounded = Math.floor(result.count / 10) * 10;
        el.textContent = rounded + '+';
      }
    }).catch(function(){});
  })();
