// UI language switch (EN ⇄ PT). Translates every text node and title/placeholder attribute in the page,
// including content rendered later (observed with a MutationObserver), and restores the English originals on switch-back.
const PT = {
  // top bar / modes / menus
  'Wildfire Forensic Analysis': 'Análise Forense de Incêndios', 'Wildfire data analysis': 'Análise de dados de incêndios', 'Incident': 'Incidente', 'Drones': 'Drones', 'Resources': 'Recursos',
  'View': 'Ver', 'Analysis': 'Análise', 'Share': 'Partilhar', 'Settings': 'Definições', 'Toggle side panel': 'Mostrar/ocultar painel lateral',
  'Incidents': 'Incidentes', 'Incident overview…': 'Resumo do incidente…', 'Overview is in the side panel': 'O resumo está no painel lateral',
  'Pedrógão Grande 2017 · real data': 'Pedrógão Grande 2017 · dados reais', 'Ridgeview Incident · synthetic demo': 'Incidente Ridgeview · demo sintético',
  'Analysis window · Jun 17 – Jun 22, 2017': 'Janela de análise · 17 – 22 jun 2017', 'Analysis window · Aug 14 – Aug 18, 2024': 'Janela de análise · 14 – 18 ago 2024',
  'Ignitions (Pedrógão · Góis)': 'Ignições (Pedrógão · Góis)', 'Fire surrounds Pobrais': 'Fogo cerca Pobrais', 'Downburst · EN236-1': 'Downburst · EN236-1',
  'First VIIRS night pass': '1.ª passagem noturna VIIRS', 'Extinction — Pedrógão (SGIF)': 'Extinção — Pedrógão (SGIF)', 'Play full incident': 'Reproduzir todo o incidente',
  'Jump to ignition': 'Ir para a ignição', 'Jump to spot fire': 'Ir para o foco secundário', 'Jump to containment': 'Ir para a contenção',
  'Place labels': 'Nomes de locais', 'Unit tags': 'Etiquetas de meios', 'Atmospheric haze': 'Neblina atmosférica', 'Terrain exaggeration': 'Exagero do relevo',
  '2D map': 'Mapa 2D', '3D terrain': 'Terreno 3D', 'Reset camera': 'Repor câmara', 'Fullscreen': 'Ecrã inteiro', 'Post-fire imagery (S2, 8 Aug 2017)': 'Imagem pós-fogo (S2, 8 ago 2017)',
  'Measure distance': 'Medir distância', 'Draw elevation profile…': 'Desenhar perfil de elevação…', 'Fly to origin area': 'Voar para a área de origem',
  'Re-run spread model…': 'Correr de novo o modelo de propagação…', 'Origin & cause summary': 'Resumo de origem e causa',
  'Copy link to this view': 'Copiar link desta vista', 'Export snapshot (PNG)': 'Exportar imagem (PNG)', 'Export incident report': 'Exportar relatório do incidente',
  'Sources, limitations & credits': 'Fontes, limitações e créditos', 'Present mode': 'Modo apresentação',
  // layers
  'Layers': 'Camadas', 'Evidence': 'Provas', 'Notes': 'Notas', 'Terrain (3D)': 'Terreno (3D)', 'Aerial Imagery': 'Imagem aérea', 'Burn Scar (dNBR)': 'Cicatriz do fogo (dNBR)',
  'Burn Severity (S2 dNBR)': 'Severidade (S2 dNBR)', 'Fire Spread (Modeled)': 'Propagação (modelada)', 'Fire Progression (Reconstructed)': 'Progressão do fogo (reconstruída)',
  'Ignition Probability': 'Probabilidade de ignição', 'Ignition Points (SGIF)': 'Pontos de ignição (SGIF)', 'Weather (Wind Vectors)': 'Meteorologia (vento)',
  'Weather (ERA5 Wind)': 'Meteorologia (vento ERA5)', 'Suppression (Drops & Line)': 'Supressão (descargas e linha)', 'Air Drops (illustrative)': 'Descargas aéreas (ilustrativo)',
  'Structures': 'Estruturas', 'Roads & Trails': 'Estradas e trilhos', 'Administrative Boundaries': 'Limites administrativos', 'Villages (OSM)': 'Aldeias (OSM)', 'Roads (OSM)': 'Estradas (OSM)',
  'Satellite Hotspots (VIIRS/MODIS)': 'Focos de calor de satélite (VIIRS/MODIS)', 'CTI: Fatalities · PCO · Road Closures': 'CTI: vítimas · PCO · cortes de estrada', 'CTI: Fatalities · Command Post': 'CTI: vítimas · posto de comando', 'Road closures (CTI)': 'Cortes de estrada (CTI)', 'Save camera still (PNG)': 'Guardar imagem da câmara (PNG)', 'Follow fire': 'Seguir fogo', 'Camera follows the fire during playback': 'A câmara segue o fogo durante a reprodução', 'Fire history before 2017 (ICNF)': 'Histórico de fogo antes de 2017 (ICNF)', 'Burned again 2018–2025 (ICNF)': 'Voltou a arder 2018–2025 (ICNF)', 'Road closures': 'Cortes de estrada', 'Show or hide road closures': 'Mostrar ou ocultar os cortes de estrada',
  // overview / weather
  'Incident Overview': 'Resumo do incidente', 'Edit': 'Editar', 'Save': 'Guardar', 'Incident Name': 'Nome', 'Incident ID': 'ID do incidente', 'Location': 'Localização',
  'Start (Est.)': 'Início (est.)', 'End': 'Fim', 'Total Acres': 'Área total', 'Cause (Prelim.)': 'Causa (prelim.)', 'Analysis Status': 'Estado da análise', 'In Progress': 'Em curso',
  'Under Investigation': 'Em investigação', 'SGIF IDs': 'IDs SGIF', 'Ignition': 'Ignição', 'Extinction': 'Extinção', 'Burned Area': 'Área ardida', 'Cause': 'Causa',
  'Fatalities': 'Vítimas mortais', 'Buildings': 'Edifícios', 'Pedrógão Grande + Góis': 'Pedrógão Grande + Góis', 'Power line (PG) · lightning (Góis)': 'Linha elétrica (PG) · raio (Góis)',
  'Weather & Fire Behavior': 'Meteorologia e comportamento do fogo', '(at cursor)': '(no cursor)', '(at fire front)': '(na frente de fogo)', '(at ignition)': '(na ignição)',
  'Show conditions': 'Mostrar condições', 'At cursor': 'No cursor', 'At fire front': 'Na frente de fogo', 'At ignition point': 'No ponto de ignição',
  'Wind': 'Vento', 'Temp': 'Temp.', 'RH': 'HR', 'Fuel Moisture': 'Humidade do combustível', 'Flame Length': 'Altura da chama', 'Burned out': 'Já ardeu', 'downburst': 'downburst',
  // tooltip
  'Inside the final perimeter': 'Dentro do perímetro final', 'Outside the final perimeter': 'Fora do perímetro final', 'active': 'ativo',
  'Agriculture / pasture': 'Agricultura / pastagem', 'Shrubland (matos)': 'Matos', 'Forest (eucalyptus / maritime pine)': 'Floresta (eucalipto / pinheiro-bravo)', 'Water / bare / built-up': 'Água / solo nu / edificado',
  'Annual grass, light': 'Erva anual, leve', 'Chaparral, moderate': 'Mato, moderado', 'Mixed conifer, heavy': 'Coníferas mistas, denso', 'Open water': 'Água',
  'Unburned': 'Não ardido', 'Low severity': 'Severidade baixa', 'Moderate-low': 'Moderada-baixa', 'Moderate-high': 'Moderada-alta', 'High severity': 'Severidade alta',
  // timeline / feed
  'Timeline': 'Linha temporal', 'Play (Space)': 'Reproduzir (Espaço)', 'Pause (Space)': 'Pausa (Espaço)', 'Next event': 'Próximo evento',
  'Key Events': 'Eventos-chave', '+ Add': '+ Adicionar', 'Detections': 'Deteções', 'Satellite Detections': 'Deteções de satélite', 'Air Ops Log': 'Registo de operações aéreas',
  'Operations Log': 'Registo de operações', 'Scanning… detections from drone sensors appear here.': 'A analisar… as deteções dos sensores dos drones aparecem aqui.',
  'No satellite pass has detected fire yet (first VIIRS night pass: Jun 18, 03:05).': 'Nenhuma passagem de satélite detetou fogo ainda (1.ª passagem noturna VIIRS: 18 jun, 03:05).',
  'Ignition (est.)': 'Ignição (est.)', 'Rapid Growth': 'Crescimento rápido', 'Spot Fire (prob.)': 'Foco secundário (prov.)', 'Ridge Crossing': 'Passagem da cumeada', 'Containment (est.)': 'Contenção (est.)',
  // charts
  'Fire Area (acres)': 'Área ardida (acres)', 'Rate of Spread (chains/hr)': 'Velocidade de propagação (chains/h)', 'Elevation Profile (selected path)': 'Perfil de elevação (percurso)',
  'Burned Area (ha)': 'Área ardida (ha)', 'Growth Rate (ha/h)': 'Crescimento (ha/h)', 'Elevation Profile · EN236-1': 'Perfil de elevação · EN236-1',
  'Altitude (ft AGL)': 'Altitude (pés AGL)', 'Max Temperature in View (°C)': 'Temperatura máx. na imagem (°C)', 'Battery (%)': 'Bateria (%)',
  'Retardant Dropped (gal)': 'Retardante largado (gal)', 'Fire Line Built (chains)': 'Linha de contenção (chains)', 'Personnel Assigned': 'Pessoal atribuído',
  'Operatives on scene · ANPC': 'Operacionais no terreno · ANPC', 'Vehicles by type · ANPC': 'Veículos por tipo · ANPC', 'Aerial Means': 'Meios aéreos',
  'Operatives (Pedrógão)': 'Operacionais (Pedrógão)', 'Vehicles': 'Veículos', 'Chart options': 'Opções do gráfico', 'Export CSV': 'Exportar CSV',
  'Copy current value': 'Copiar valor atual', 'Draw new profile path…': 'Desenhar novo percurso…', 'Reset to progression path': 'Repor percurso de progressão',
  // drones
  'Drone Fleet': 'Frota de drones', 'Altitude': 'Altitude', 'Ground speed': 'Velocidade', 'Heading': 'Rumo', 'Battery': 'Bateria', 'Link': 'Ligação', 'Flight time': 'Tempo de voo',
  'Aircraft': 'Aeronave', 'Mission': 'Missão', 'Task': 'Tarefa', 'Sensor': 'Sensor', 'Position': 'Posição', 'Gimbal': 'Gimbal', 'Full camera view': 'Câmara em ecrã inteiro',
  'Exit full view': 'Sair do ecrã inteiro', 'Thermal': 'Térmica', 'Capture still to Evidence': 'Captar imagem para Provas', 'Zoom in': 'Aproximar', 'Zoom out': 'Afastar',
  'Close feed': 'Fechar imagem', 'White hot': 'Branco quente', 'Ironbow': 'Ironbow', 'cycle': 'ciclo', 'ft AGL': 'pés AGL', 'kn': 'nós', 'dBm': 'dBm',
  'Mapping': 'Mapeamento', 'Orbit · active fire': 'Órbita · fogo ativo', 'Orbit · spot fire': 'Órbita · foco secundário', 'Patrol': 'Patrulha', 'Survey': 'Levantamento', 'Relay': 'Retransmissão',
  'Perimeter mapping': 'Mapeamento do perímetro', 'Head fire watch': 'Vigilância da cabeça', 'Flank & spot watch': 'Vigilância de flanco e focos', 'Structure protection': 'Proteção de estruturas',
  'Hotspot survey': 'Levantamento de reacendimentos',
  'Flying the current fire edge, mapping it every lap': 'Voa sobre a orla atual do fogo, mapeando-a a cada volta', 'Holding over the head of the fire, tracking rate of spread': 'Mantém-se sobre a cabeça do fogo, a medir a velocidade de propagação',
  'Circling the next most active part of the fire (the spot fire once it starts)': 'Circula sobre a parte mais ativa seguinte (o foco secundário quando surge)', 'Patrolling Oak Flats and East Fork': 'Patrulha de Oak Flats e East Fork',
  'Survey lines over the burn scar for hold-over heat': 'Linhas de levantamento sobre a área ardida à procura de reacendimentos', 'Relay for crews in Canyon Creek': 'Retransmissão para as equipas em Canyon Creek',
  'Official report': 'Relatório oficial', 'Scientific paper': 'Artigo científico', 'Official data': 'Dados oficiais', 'Satellite data': 'Dados de satélite', 'News timeline': 'Cronologia jornalística', 'Comms relay': 'Retransmissão de comunicações', 'Quadcopter': 'Quadricóptero', 'Fixed-wing': 'Asa fixa', 'Fixed-wing VTOL': 'Asa fixa VTOL',
  // resources
  'Operations': 'Operações', 'Air ops active': 'Operações aéreas ativas', 'Aircraft · illustrative positions': 'Aeronaves · posições ilustrativas', 'Ground · illustrative positions': 'Meios terrestres · posições ilustrativas',
  'Engines & Tenders': 'Viaturas e tanques', 'Crews & Dozers': 'Equipas e máquinas', 'operatives (ANPC)': 'operacionais (ANPC)', 'vehicles': 'veículos', 'aerial means': 'meios aéreos', 'fatalities': 'vítimas',
  'aircraft up': 'aeronaves no ar', 'gal retardant': 'gal retardante', 'chains line': 'chains de linha', 'personnel': 'pessoal', 'Airspeed': 'Velocidade', 'Agency': 'Entidade', 'Assignment': 'Missão',
  'Drops': 'Descargas', 'Speed': 'Velocidade', 'Personnel': 'Pessoal', 'Division': 'Divisão', 'Line built': 'Linha construída', 'Chase': 'Perseguir', 'Cockpit': 'Cockpit', 'Overview': 'Visão geral',
  'Ride along': 'Acompanhar', 'Inbound': 'A caminho', 'On final': 'Em aproximação final', 'Dropping': 'A largar', 'Return to reload': 'Regresso para recarregar', 'Reloading': 'A recarregar',
  'To drop': 'Para descarga', 'Filling': 'A abastecer', 'Return to fill': 'Regresso para abastecer', 'Air Attack · supervising': 'Coordenação aérea', 'Holding & mop-up': 'Consolidação e rescaldo',
  'Supervising': 'Coordenação', 'Role': 'Função', 'Water': 'Água', 'Retardant': 'Retardante', 'on unit': 'na viatura', 'ICS': 'SGO', 'mph': 'mph', 'kt': 'nós',
  'Drag to look around · scroll to move the camera · C to switch view': 'Arraste para olhar à volta · roda do rato para afastar · C para mudar de vista',
  'Click an aircraft to ride along with it. Click an engine, crew or dozer to follow it. Drops leave retardant lines that fade over the following days.': 'Clique numa aeronave para a acompanhar. Clique numa viatura, equipa ou máquina para a seguir. As descargas deixam linhas que desvanecem nos dias seguintes.',
  // analysis tab
  'Origin determination': 'Determinação da origem', 'Area of origin': 'Área de origem', 'Confidence': 'Confiança', 'Indicators': 'Indicadores', 'Fly to origin': 'Voar para a origem',
  'Profile path': 'Percurso do perfil', 'Fire behavior': 'Comportamento do fogo', 'Final area': 'Área final', 'Peak rate of spread': 'Velocidade máxima', 'Max growth (1 h)': 'Crescimento máx. (1 h)',
  'Spot fire': 'Foco secundário', 'Primary driver': 'Fator principal', 'Re-run spread model': 'Correr de novo o modelo', 'Cause hypotheses': 'Hipóteses de causa',
  'Ignitions (SGIF / ICNF)': 'Ignições (SGIF / ICNF)', 'Area (SGIF)': 'Área (SGIF)', 'Fly to Escalos Fundeiros': 'Voar para Escalos Fundeiros', 'Reconstructed progression': 'Progressão reconstruída',
  'Burned by Jun 17, 20:00': 'Ardido até 17 jun, 20:00', 'Burned by Jun 18, 00:00': 'Ardido até 18 jun, 00:00', 'Burned by Jun 18, 12:00': 'Ardido até 18 jun, 12:00', 'Burned by Jun 19, 12:00': 'Ardido até 19 jun, 12:00',
  'Peak growth': 'Crescimento máximo', 'Final burn scar (Sentinel-2)': 'Cicatriz final (Sentinel-2)', 'Official area (SGIF, 2 fires)': 'Área oficial (SGIF, 2 fogos)',
  'Official perimeter (ICNF, WFS)': 'Perímetro oficial (ICNF, WFS)', 'Burned on 17–18 Jun (ADAI)': 'Ardido a 17–18 jun (ADAI)', 'Buildings (ADAI field survey)': 'Edifícios (levantamento ADAI)',
  'Heavily damaged / destroyed': 'Muito danificados / destruídos', 'Fire arrival 18:30–20:30': 'Chegada do fogo 18:30–20:30', 'Pyro-meteorology': 'Pirometeorologia',
  'ERA5 at 15:00 (17 Jun)': 'ERA5 às 15:00 (17 jun)', 'Dry thunderstorm (IPMA)': 'Trovoada seca (IPMA)', 'Downburst': 'Downburst', 'Junction fire Escalos + Regadas': 'Junção Escalos + Regadas',
  'CTI 2017 — key findings': 'CTI 2017 — conclusões principais', 'Dominated': 'Dominado', 'No aircraft': 'Sem meios aéreos', 'Causes of death': 'Causas de morte', 'International': 'Internacional',
  'Entities': 'Entidades', 'Incident commanders (COS)': 'Comandantes das operações (COS)', 'Armed forces (ADAI report)': 'Forças Armadas (relatório ADAI)', 'Navy': 'Marinha', 'Dozers': 'Máquinas de rasto',
  'Air Force flight hours': 'Horas de voo da Força Aérea', 'Meals served': 'Refeições servidas', 'Data sources': 'Fontes de dados',
  'Equipment use (mowing / grinding)': 'Uso de maquinaria (corte / trituração)', 'Power line': 'Linha elétrica', 'Vehicle (hot exhaust / brakes)': 'Veículo (escape / travões)', 'Arson': 'Fogo posto',
  'Debris burning': 'Queima de sobrantes', 'Lightning': 'Raio', 'SW wind + upslope alignment': 'Vento de SW + subida de encosta',
  // evidence / notes / dialogs
  '+ Add evidence': '+ Adicionar prova', 'Add note': 'Adicionar nota', 'No notes yet. Notes are pinned to the timeline position.': 'Ainda não há notas. As notas ficam presas à hora na linha temporal.',
  'Evidence ID': 'ID da prova', 'Type': 'Tipo', 'Details': 'Detalhes', 'Chain of custody': 'Cadeia de custódia', 'Logged · sealed': 'Registado · selado', 'Close': 'Fechar', 'Cancel': 'Cancelar',
  'Add': 'Adicionar', 'Title': 'Título', 'Photo': 'Fotografia', 'Physical': 'Física', 'Statement': 'Depoimento', 'Data': 'Dados', 'Report': 'Relatório', 'Drone': 'Drone',
  'Add key event': 'Adicionar evento-chave', 'Time': 'Hora', 'Name': 'Nome', 'Add event': 'Adicionar evento', 'Current view centre': 'Centro da vista atual',
  'Rate-of-spread factor': 'Fator de velocidade', 'Wind influence': 'Influência do vento', 'Wind ellipse eccentricity': 'Excentricidade da elipse do vento', 'Run model': 'Correr modelo',
  'Elevation units': 'Unidades de altitude', 'Metric (m)': 'Métrico (m)', 'Imperial (ft)': 'Imperial (pés)', 'Render resolution': 'Resolução', 'Standard (1×)': 'Normal (1×)', 'High (1.5×)': 'Alta (1,5×)',
  'Retina (2×)': 'Retina (2×)', 'Municipal boundaries (OSM)': 'Limites dos concelhos (OSM)', 'Auto (adaptive)': 'Automática (adaptativa)', 'Show trees': 'Mostrar árvores', 'Show FPS counter': 'Mostrar FPS', 'Playback rate at 1×': 'Velocidade a 1×', 'Apply': 'Aplicar',
  'Click on the terrain to add points': 'Clique no terreno para adicionar pontos', 'Click to draw the elevation-profile path': 'Clique para desenhar o percurso do perfil', 'Done': 'Concluir',
  // toasts / loading / misc
  'Copied': 'Copiado', 'Link copied to clipboard': 'Link copiado', 'Copy failed': 'Falha ao copiar', 'Snapshot exported': 'Imagem exportada', 'Settings applied': 'Definições aplicadas',
  'Incident overview saved': 'Resumo guardado', 'Allow pop-ups to open the report': 'Permita pop-ups para abrir o relatório', 'Loading…': 'A carregar…', 'Generating terrain': 'A gerar o terreno',
  'Simulating fire spread': 'A simular a propagação', 'Loading incident data': 'A carregar dados do incidente', 'Loading terrain & fire record': 'A carregar terreno e registo do fogo',
  'Building terrain': 'A construir o terreno', 'Computing terrain normals': 'A calcular o relevo', 'Baking imagery & hillshade': 'A preparar imagem e sombreamento', 'Loading Sentinel-2 imagery': 'A carregar imagem Sentinel-2',
  'Draping imagery over terrain': 'A aplicar a imagem no terreno', 'Building terrain mesh': 'A construir a malha do terreno', 'Planting trees': 'A plantar árvores', 'Tracing perimeters': 'A traçar perímetros',
  'Deploying resources': 'A posicionar meios', 'Preparing workspace': 'A preparar a área de trabalho', 'Reset north': 'Repor norte', 'Fontes, limitações e créditos': 'Fontes, limitações e créditos',
  'Start': 'Início', 'Panel': 'Painel',
};
// patterns (applied to whole text nodes)
const RULES = [
  [/^Burned (.+)$/, 'Ardeu $1'], [/^Burns (.+)$/, 'Arde $1'], [/^· (\d+) of (\d+) airborne$/, '· $1 de $2 no ar'],
  [/^· documented totals \(ANPC\/press\)$/, '· totais documentados (ANPC/imprensa)'], [/^· (\d+) units · (\d+) active$/, '· $1 meios · $2 ativos'],
  [/^(\d+) of (\d+)$/, '$1 de $2'], [/^(\d+) of (\d+) answers$/, '$1 de $2 respostas'], [/^((?:EV|DOC|DAT)-\d+) · (\w+)$/, (m, a, b) => `${a} · ${PT[b] || b}`],
  [/^Progression digitized from the official ADAI\/CEIF isochrone map.*$/s, 'Progressão digitalizada do mapa oficial de isócronas da ADAI/CEIF (Ribeiro et al. 2020, Fig. 1: 15 classes, 17 jun 16:00 → 21 jun 23:59), alinhada com a cicatriz Sentinel-2, interpolada por distância dentro de cada classe e fundida com as deteções de satélite como limite superior (95% das deteções coerentes no tempo). Validação: o fogo chega aos locais das vítimas da CTI 0–40 min antes das mortes registadas; crescimento 19:30–20:30 ≈ 3 960 ha (ADAI: ~3 800 ha). Área ardida = Sentinel-2 dNBR > 0,22 (14 jun → 8 ago 2017). As deteções VIIRS/MODIS servem de verificação independente.'],
  [/^from (.+)$/, 'a partir de $1'], [/^on scene (.+)$/, 'no TO $1'], [/^~(\d+) min left$/, '~$1 min restantes'], [/^(\d+) this session$/, '$1 nesta sessão'],
  [/^(.*) only joins from (.*)$/, '$1 só entra a partir de $2'], [/^Load · (.+)$/, 'Carga · $1'], [/^arrived (.+)$/, 'chegados $1'],
  [/^Elevation profile set · (.+)$/, 'Perfil de elevação definido · $1'], [/^Distance (.+) · elevation Δ (.+)$/, 'Distância $1 · Δ altitude $2'],
  [/^Labels (on|off)$/, (m, a) => `Nomes ${a === 'on' ? 'ligados' : 'desligados'}`], [/^Vertical exaggeration (.+)$/, 'Exagero vertical $1'],
  [/^Still captured to Evidence · (.+)$/, 'Imagem guardada em Provas · $1'], [/^Event added · (.+)$/, 'Evento adicionado · $1'],
  [/^(\d+) pts · (.+) · Done to (set profile|finish)$/, (m, a, b, c) => `${a} pts · ${b} · Concluir para ${c === 'finish' ? 'terminar' : 'definir o perfil'}`],
  [/^Sentinel-2 · 8 Aug 2017 \(after\)$/, 'Sentinel-2 · 8 ago 2017 (depois)'], [/^Sentinel-2 · 14 Jun 2017 \(before\)$/, 'Sentinel-2 · 14 jun 2017 (antes)'],
  [/^Camera still saved · (.+)$/, 'Imagem da câmara guardada · $1'], [/^Spread model re-run · (.+) acres final$/, 'Modelo recalculado · $1 acres no final'], [/^Running spread model…$/, 'A correr o modelo…'],
];
const SUBS = [[/ slope · /g, ' de declive · '], [/ · gust (\d+)$/, ' · raj. $1'], [/ · arrived /, ' · chegados '], [/-facing$/g, ' (exposição)'], [/^(\d[\d,.]*) damaged · (\d+) heavy\/destroyed$/, '$1 danificados · $2 muito danificados/destruídos'],
  [/ while fleeing, /, ' em fuga, '], [/ on EN236-1\)/, ' na EN236-1)'], [/\(\+ Regadas /, '(+ Regadas '], [/^(\d[\d,]*) ha \(ICNF\) · /, '$1 ha (ICNF) · ']];

let lang = 'en';
try { lang = localStorage.getItem('firetrace.lang') || ((navigator.language || '').toLowerCase().startsWith('pt') ? 'pt' : 'en'); } catch (e) { lang = (navigator.language || '').toLowerCase().startsWith('pt') ? 'pt' : 'en'; }
const ORIG = new WeakMap();      // text node -> English original
const ORIG_ATTR = new WeakMap(); // element -> {attr: original}
export const getLang = () => lang;

function tr(s) {
  const t = s.trim(); if (!t) return null;
  if (Object.prototype.hasOwnProperty.call(PT, t)) return s.replace(t, PT[t]);
  for (const [re, rep] of RULES) if (re.test(t)) return s.replace(t, t.replace(re, rep));
  let out = t, hit = false;
  for (const [re, rep] of SUBS) { if (re.test(out)) { out = out.replace(re, rep); hit = true; } re.lastIndex = 0; }
  return hit ? s.replace(t, out) : null;
}
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CANVAS']);
function translateNode(root) {
  if (lang !== 'pt' || !root) return;
  if (root.nodeType === 3) { doText(root); return; }
  if (root.nodeType !== 1 || SKIP.has(root.tagName) || root.closest?.('[data-no-i18n]')) return;
  doAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === 1 ? (SKIP.has(n.tagName) || n.hasAttribute('data-no-i18n') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : NodeFilter.FILTER_ACCEPT),
  });
  root.querySelectorAll?.('[title],[placeholder]').forEach(doAttrs);
  let n; while ((n = w.nextNode())) doText(n);
}
function doText(n) {
  const v = n.nodeValue; if (!v || !/[A-Za-z]/.test(v)) return;
  const t = tr(v); if (t === null || t === v) return;
  ORIG.set(n, v); n.nodeValue = t;
}
function doAttrs(el) {
  if (el.nodeType !== 1) return;
  for (const a of ['title', 'placeholder']) {
    const v = el.getAttribute(a); if (!v) continue;
    const t = tr(v); if (t === null || t === v) continue;
    const o = ORIG_ATTR.get(el) || {}; if (!o[a]) o[a] = v; ORIG_ATTR.set(el, o); el.setAttribute(a, t);
  }
}
function restoreAll() {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) { const o = ORIG.get(n); if (o !== undefined) { n.nodeValue = o; ORIG.delete(n); } }
  document.querySelectorAll('[title],[placeholder]').forEach((el) => { const o = ORIG_ATTR.get(el); if (o) { for (const a in o) el.setAttribute(a, o[a]); ORIG_ATTR.delete(el); } });
}
let obs = null;
export function initI18n(onChange) {
  obs = new MutationObserver((recs) => {
    if (lang !== 'pt') return;
    for (const r of recs) {
      if (r.type === 'characterData') doText(r.target);
      else if (r.type === 'attributes') doAttrs(r.target);
      else r.addedNodes.forEach(translateNode);
    }
  });
  obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder'] });
  document.documentElement.lang = lang;
  if (lang === 'pt') translateNode(document.body);
  document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang, onChange)));
  syncButtons();
}
function syncButtons() { document.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang)); }
export function setLang(l, onChange) {
  if (l === lang) return;
  lang = l;
  try { localStorage.setItem('firetrace.lang', l); } catch (e) { /* ignore */ }
  document.documentElement.lang = l;
  if (l === 'pt') translateNode(document.body); else restoreAll();
  syncButtons();
  onChange && onChange(l);
}
