(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  // --- Chart: Budget Comparison (砖混 vs 框架) ---
  var chartBudget = echarts.init(document.getElementById('chart-budget'), null, { renderer: 'svg' });
  chartBudget.setOption({
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      appendToBody: true,
      formatter: function(params) {
        var html = '<div style="font-weight:600;margin-bottom:4px;">' + params[0].name + '</div>';
        params.forEach(function(p) {
          html += '<div style="color:' + p.color + ';">' + p.seriesName + ': ' + p.value + ' 万</div>';
        });
        return html;
      }
    },
    legend: {
      data: ['砖混方案', '框架方案'],
      bottom: 0,
      textStyle: { color: muted, fontSize: 12 }
    },
    grid: {
      left: '8%',
      right: '5%',
      top: 30,
      bottom: 50
    },
    xAxis: {
      type: 'category',
      data: ['基础工程', '主体结构', '屋面工程', '外墙装饰', '门窗工程', '水电改造', '墙地面', '厨卫装修', '吊顶墙面', '配套费用'],
      axisLabel: {
        color: muted,
        fontSize: 10,
        rotate: 35,
        interval: 0
      },
      axisLine: { lineStyle: { color: rule } }
    },
    yAxis: {
      type: 'value',
      name: '金额（万元）',
      nameTextStyle: { color: muted, fontSize: 11 },
      axisLabel: { color: muted, fontSize: 11 },
      splitLine: { lineStyle: { color: rule, type: 'dashed' } },
      axisLine: { lineStyle: { color: rule } }
    },
    series: [
      {
        name: '砖混方案',
        type: 'bar',
        data: [4, 48.5, 3, 4.5, 4.5, 4, 7.5, 4.5, 4.5, 3.9],
        itemStyle: { color: accent2, borderRadius: [3, 3, 0, 0] },
        barGap: '10%',
        barCategoryGap: '40%'
      },
      {
        name: '框架方案',
        type: 'bar',
        data: [5.5, 69, 3, 4.5, 4.5, 4, 7.5, 4.5, 4.5, 3.9],
        itemStyle: { color: accent, borderRadius: [3, 3, 0, 0] }
      }
    ]
  });
  window.addEventListener('resize', function() { chartBudget.resize(); });
})();
