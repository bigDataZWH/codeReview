(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  // --- Radar Chart: Capability Coverage ---
  var chart = echarts.init(document.getElementById('chart-radar'), null, { renderer: 'svg' });
  chart.setOption({
    animation: false,
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      backgroundColor: '#fff',
      borderColor: rule,
      textStyle: { color: ink, fontSize: 13 }
    },
    legend: {
      bottom: 0,
      textStyle: { color: muted, fontSize: 12 },
      itemWidth: 16,
      itemHeight: 10,
      itemGap: 20
    },
    radar: {
      indicator: [
        { name: '代码结构理解', max: 10 },
        { name: '审查精度', max: 10 },
        { name: 'Token效率', max: 10 },
        { name: '安全审查', max: 10 },
        { name: '误报控制', max: 10 },
        { name: '部署灵活性', max: 10 },
        { name: '模型灵活性', max: 10 },
        { name: '可扩展性', max: 10 }
      ],
      radius: '62%',
      shape: 'polygon',
      splitNumber: 5,
      axisName: {
        color: ink,
        fontSize: 12
      },
      splitLine: { lineStyle: { color: rule } },
      splitArea: { areaStyle: { color: ['rgba(15,118,110,0.02)', 'rgba(124,58,237,0.02)'] } },
      axisLine: { lineStyle: { color: rule } }
    },
    series: [{
      type: 'radar',
      data: [
        {
          name: '整合方案',
          value: [9, 9, 9, 9, 9, 9, 9, 9],
          areaStyle: { color: accent + '30' },
          lineStyle: { color: accent, width: 2 },
          itemStyle: { color: accent },
          symbol: 'circle',
          symbolSize: 6
        },
        {
          name: 'code-review-graph',
          value: [10, 5, 10, 3, 4, 5, 8, 7],
          areaStyle: { color: '#3b82f6' + '15' },
          lineStyle: { color: '#3b82f6', width: 1.5, type: 'dashed' },
          itemStyle: { color: '#3b82f6' },
          symbol: 'circle',
          symbolSize: 4
        },
        {
          name: 'open-code-review',
          value: [2, 9, 8, 7, 8, 6, 8, 8],
          areaStyle: { color: '#f59e0b' + '15' },
          lineStyle: { color: '#f59e0b', width: 1.5, type: 'dashed' },
          itemStyle: { color: '#f59e0b' },
          symbol: 'circle',
          symbolSize: 4
        },
        {
          name: 'claude-security-review',
          value: [1, 7, 4, 10, 10, 3, 2, 4],
          areaStyle: { color: '#ef4444' + '15' },
          lineStyle: { color: '#ef4444', width: 1.5, type: 'dashed' },
          itemStyle: { color: '#ef4444' },
          symbol: 'circle',
          symbolSize: 4
        },
        {
          name: 'ChatGPT-CodeReview',
          value: [1, 5, 3, 2, 2, 8, 5, 3],
          areaStyle: { color: '#8b5cf6' + '15' },
          lineStyle: { color: '#8b5cf6', width: 1.5, type: 'dashed' },
          itemStyle: { color: '#8b5cf6' },
          symbol: 'circle',
          symbolSize: 4
        }
      ]
    }]
  });
  window.addEventListener('resize', function() { chart.resize(); });
})();