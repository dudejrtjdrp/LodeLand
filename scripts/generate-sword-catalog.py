#!/usr/bin/env python3
# 검 카탈로그 생성기 — 6시트 통합(swords.png, 32px 186프레임) 기반 186종.
# 기존 19종(id 보존)은 swordCatalog.json에서 그대로 계승하고 rarity만 부여,
# 신규 158종은 아래 AUTHORING 테이블(이름/원소/등급/계열/로어)에서 스탯을 공식으로 생성한다.
# 실행: python3 scripts/generate-sword-catalog.py  (repo 루트에서)
#
# ※ 주의 — 이 스크립트는 카탈로그를 **전부 다시 쓴다**. 밸런스 튜닝
#   (scripts/balance-sim/TUNING.md 의 원소별 피해·쿨다운 배율, 열등 검 보정)은
#   생성 후 JSON 을 직접 손본 것이라 재실행하면 사라진다. 검을 몇 종만 더할 때는
#   scripts/add-electric-swords.py 처럼 build_entry 만 빌려 쓰는 추가 스크립트를 쓸 것.
import json, hashlib, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET = os.path.join(ROOT, 'public/assets/swords.png')
CATALOG = os.path.join(ROOT, 'src/data/swordCatalog.json')
EVOCAT = os.path.join(ROOT, 'src/data/evolutionCatalog.json')

# 검이 아닌 장난 프레임 (다리/실뭉치/아이스크림/리본).
#   44·87·101  → 2026-09-01 add-behavior-swords.py 가 아키타입 대표 검으로 덮어씀
#   108·114·155 → 2026-09-01 add-archetype-swords.py 가 확대 3종으로 덮어씀
# 이제 186프레임에 남는 칸이 없다 — 검을 더 늘리려면 시트를 한 행(6칸) 늘려야 하고,
# 그때는 로더·프레임 수 회귀(texFrames === 187)도 함께 손봐야 한다.
EXCLUDED: set[int] = set()

R = {'common': 0, 'uncommon': 1, 'rare': 2, 'epic': 3, 'legendary': 4, 'mythic': 5}

# 기존 19종 rarity 부여
EXISTING_RARITY = {
    'bronze': 'common', 'rusty': 'common', 'steel': 'uncommon', 'ruby': 'rare',
    'emerald': 'epic', 'gold': 'epic', 'violet': 'legendary', 'obsidian': 'legendary',
    'inferno': 'legendary', 'storm': 'legendary', 'voidreaver': 'legendary',
    'anvilkite': 'rare', 'coinquill': 'epic', 'slagroc': 'rare', 'rotwing': 'rare',
    'railshrike': 'epic', 'hollowowl': 'epic', 'verdiwing': 'epic', 'pyreroc': 'legendary',
}

# (frame, id, name, element|None, rarity, archetype, evolvedResult, lore)
T = [
    (19,'thornswift','Thornswift','poison','uncommon','swift',0,'덩굴이 제 스스로 사냥감을 조른다.'),
    (20,'boltbeak','Boltbeak',None,'uncommon','heavy',0,'화살촉을 통째로 벼린 묵직한 부리.'),
    (21,'palefeather','Palefeather',None,'uncommon','standard',0,'장식 세공 사이에 초록 심이 하나 박혀 있다.'),
    (22,'chainshrike','Chainshrike',None,'epic','standard',0,'사슬 고리가 풀리며 사냥감을 얽어맨다.'),
    (23,'mosskite','Mosskite','poison','rare','standard',0,'숲의 오래된 그늘에서 벼려졌다.'),
    (24,'duskquill','Duskquill','void','rare','assassin',0,'해질녘의 보랏빛만 모아 갈았다.'),
    (25,'woodfinch','Woodfinch',None,'common','orbital',0,'견습 키퍼의 첫 연습 상대. 가볍고 정직하다.'),
    (26,'runekite','Runekite','fire','uncommon','standard',0,'홈마다 새긴 룬이 아직 뜨겁다.'),
    (27,'gnarlowl','Gnarlowl','void','uncommon','heavy',0,'뒤틀린 쇠가 뒤틀린 울음을 운다.'),
    (28,'sunfinch','Sunfinch','gold','rare','standard',0,'왕가의 금고에서 날아올랐다는 소문.'),
    (29,'boneshrike','Boneshrike',None,'rare','assassin',0,'뼈처럼 희고, 뼈를 노린다.'),
    (30,'hornbeak','Hornbeak','blood','rare','heavy',0,'황소의 마지막 돌진이 깃들어 있다.'),
    (31,'glacierowl','Glacierowl','ice','rare','standard',0,'고리 안의 냉기가 녹지 않는다.'),
    (32,'ironbeak','Ironbeak',None,'common','standard',0,'군말 없는 무쇠. 키퍼들의 기본기.'),
    (33,'cleaverkite','Cleaverkite',None,'uncommon','heavy',0,'한 번에 자르지 못하면 두 번 자른다.'),
    (34,'shadewing','Shadewing','void','uncommon','swift',0,'그림자를 접어 만든 날개.'),
    (35,'frostfinch','Frostfinch','ice','common','swift',0,'첫서리처럼 얇고 차갑다.'),
    (36,'tidequill','Tidequill','ice','uncommon','standard',0,'물방울이 검 끝을 떠나지 않는다.'),
    (37,'rosetalon','Rosetalon','blood','uncommon','assassin',0,'장미 한 송이 값은 피로 치른다.'),
    (38,'coralshrike','Coralshrike','poison','uncommon','standard',0,'깊은 바다의 산호독을 머금었다.'),
    (39,'flarekite','Flarekite','fire','rare','swift',0,'불꽃 리본이 궤적을 따라 남는다.'),
    (40,'redquill','Redquill','blood','common','swift',0,'붉은 줄무늬는 장식이 아니다.'),
    (41,'silverwing','Silverwing',None,'common','standard',0,'가장 많은 키퍼가 거쳐 간 은빛 정석.'),
    (42,'amberfinch','Amberfinch','gold','uncommon','standard',0,'호박 구슬 속에 옛 볕이 갇혀 있다.'),
    (43,'crosshawk','Crosshawk',None,'common','standard',0,'주황 십자 날밑이 손을 지킨다.'),
    (45,'glassbeak','Glassbeak','ice','rare','assassin',0,'얼음인지 유리인지, 맞아본 자만 안다.'),
    (46,'twigfinch','Twigfinch','poison','common','orbital',0,'잔가지 같지만 새순의 독이 오른다.'),
    (47,'songquill','Songquill','gold','rare','standard',0,'베는 소리가 노래처럼 들린다.'),
    (48,'gazehawk','Gazehawk','void','epic','standard',0,'칼끝의 눈은 감기는 법이 없다.'),
    (49,'venomswift','Venomswift','poison','epic','swift',0,'초록 빛무리가 스치면 이미 늦었다.'),
    (50,'brineshrike','Brineshrike','ice','rare','standard',0,'세 갈래 물결이 한 점에서 만난다.'),
    (51,'gildwing','Gildwing','gold','uncommon','standard',0,'금박 날개깃이 손잡이를 감싼다.'),
    (52,'coilbeak','Coilbeak',None,'common','standard',0,'가죽끈을 감고 또 감은 실전용.'),
    (53,'graywing','Graywing',None,'common','standard',0,'이름 없는 병사들의 이름 없는 검.'),
    (54,'crosstalon','Crosstalon',None,'rare','heavy',0,'엇갈린 두 날이 한 번에 떨어진다.'),
    (55,'regalkite','Regalkite','gold','epic','standard',0,'보석 박힌 날밑이 왕좌를 기억한다.'),
    (56,'lockshrike','Lockshrike','void','rare','standard',0,'열지 못하는 문을 여는 검은 열쇠.'),
    (57,'verdantowl','Verdantowl','poison','rare','standard',0,'덩굴 눈동자가 청록으로 빛난다.'),
    (58,'aurichawk','Aurichawk','gold','mythic','standard',1,'금빛 소용돌이가 낮게 운다.'),
    (59,'jadewing','Jadewing',None,'uncommon','standard',0,'자루 끝 비취가 균형을 잡아준다.'),
    (60,'plumehawk','Plumehawk','wind','epic','swift',0,'깃털 하나가 강철을 가른다.'),
    (61,'pyrefinch','Pyrefinch','fire','rare','standard',0,'불꽃이 장미 모양으로 피어난다.'),
    (62,'vexshrike','Vexshrike','void','rare','assassin',0,'자홍 줄무늬가 어지럽게 시야를 흔든다.'),
    (63,'solarkite','Solarkite','fire','legendary','standard',0,'정오의 태양을 그대로 오려냈다.'),
    (64,'leafswift','Leafswift','wind','uncommon','swift',0,'잎맥까지 벼린 초록 깃.'),
    (65,'ashenowl','Ashenowl','void','epic','standard',0,'재가 된 것들의 기억이 연기로 남는다.'),
    (66,'lunarowl','Lunarowl','void','rare','standard',0,'초승달 날밑이 밤을 끌어온다.'),
    (67,'dawnfinch','Dawnfinch','gold','rare','standard',0,'동트는 순간의 금빛만 두드려 만들었다.'),
    (68,'wavetalon','Wavetalon','ice','epic','standard',1,'두 물길이 만나 파도가 된다.'),
    (69,'keenswift','Keenswift',None,'uncommon','swift',0,'짧고, 빠르고, 정확하다.'),
    (70,'needlequill','Needlequill',None,'uncommon','assassin',0,'바늘귀 고리 사이로 급소만 꿴다.'),
    (71,'shardowl','Shardowl','void','epic','standard',0,'흑요석 파편이 궤도를 떠돈다.'),
    (72,'rimehawk','Rimehawk','ice','legendary','standard',0,'서리꽃이 피는 자리마다 시간이 멈춘다.'),
    (73,'sporefinch','Sporefinch','poison','uncommon','orbital',0,'귀엽다고 만지면 포자가 터진다.'),
    (74,'wraithswift','Wraithswift','void','uncommon','swift',0,'베인 자리가 잠깐 투명해진다.'),
    (75,'sawbeak','Sawbeak',None,'rare','heavy',0,'톱니 하나하나가 제 몫을 문다.'),
    (76,'cinderkite','Cinderkite','fire','uncommon','standard',0,'잉걸불 위를 나는 주황 연.'),
    (77,'gorequill','Gorequill','blood','epic','standard',1,'찔린 상처는 아물 줄을 모른다.'),
    (78,'fernwing','Fernwing','poison','uncommon','standard',0,'고사리 잎이 칼몸을 감아 오른다.'),
    (79,'mossroc','Mossroc','poison','mythic','heavy',1,'이끼가 삼킨 옛 거신의 날개.'),
    (80,'redowl','Redowl','blood','epic','standard',0,'눈알이 사냥감을 먼저 찾는다.'),
    (81,'frosthawk','Frosthawk','ice','uncommon','heavy',0,'얼음 덩이가 그대로 철퇴다.'),
    (82,'malletbeak','Malletbeak',None,'common','heavy',0,'베지 못하면 부수면 된다.'),
    (83,'galewing','Galewing','wind','uncommon','standard',0,'날밑의 깃이 바람을 가른다.'),
    (84,'stitchquill','Stitchquill','blood','uncommon','standard',0,'붉은 실이 상처를 꿰매지는 않는다.'),
    (85,'mothwing','Mothwing','void','uncommon','swift',0,'나방 날개 인분이 빛을 홀린다.'),
    (86,'tineshrike','Tineshrike','void','rare','standard',0,'세 갈래 검은 이빨.'),
    (88,'dunetalon','Dunetalon',None,'uncommon','heavy',0,'사구에 묻혔다 파낸 낡은 대검.'),
    (89,'borealroc','Borealroc','ice','mythic','standard',1,'북녘의 빛이 칼날에 얼어붙었다.'),
    (90,'chimekite','Chimekite','gold','epic','standard',0,'울릴 때마다 금속 종소리가 난다.'),
    (91,'lichenbeak','Lichenbeak','poison','rare','standard',0,'천 년 이끼가 날을 덮어도 무뎌지지 않았다.'),
    (92,'drakewing','Drakewing','ice','rare','standard',0,'용의 지느러미를 본떠 벼렸다.'),
    (93,'lavaquill','Lavaquill','fire','uncommon','standard',0,'식지 않는 주황 심지.'),
    (94,'pearlhawk','Pearlhawk','gold','rare','standard',0,'자루의 진주가 달빛을 모은다.'),
    (95,'ashfinch','Ashfinch',None,'common','standard',0,'잿빛 무쇠, 수수하지만 성실하다.'),
    (96,'hookowl','Hookowl','void','uncommon','standard',0,'갈고리가 놓친 사냥감은 없다.'),
    (97,'crystalswift','Crystalswift','ice','uncommon','swift',0,'수정 날이 빛을 조각낸다.'),
    (98,'ivoryquill','Ivoryquill','gold','rare','assassin',0,'상아빛 세공 아래 금촉이 숨어 있다.'),
    (99,'stingshrike','Stingshrike','blood','uncommon','assassin',0,'독침처럼 스치고 사라진다.'),
    (100,'aegiskite','Aegiskite','gold','epic','heavy',0,'방패의 심장을 검에 옮겨 심었다.'),
    (102,'solroc','Solroc','gold','legendary','standard',0,'태양 매듭 문양이 스스로 타오른다.'),
    (103,'acidswift','Acidswift','poison','epic','swift',0,'닿은 자리부터 초록으로 녹는다.'),
    (104,'whitewing','Whitewing','wind','uncommon','standard',0,'흰 날개깃처럼 소리 없이 낙하한다.'),
    (105,'bulwarkbeak','Bulwarkbeak',None,'rare','heavy',0,'성벽 한 조각을 떼어 벼린 듯하다.'),
    (106,'prismshrike','Prismshrike','ice','rare','standard',0,'분홍 결정이 빛을 일곱 갈래로 쪼갠다.'),
    (107,'carrionowl','Carrionowl','blood','epic','standard',0,'썩은 것 위를 도는 붉은 낫.'),
    (109,'triggerbeak','Triggerbeak',None,'rare','standard',0,'방아쇠 감각으로 급소를 겨눈다.'),
    (110,'haloroc','Haloroc','fire','mythic','standard',1,'타오르는 고리가 하늘을 연다.'),
    (111,'swanroc','Swanroc','wind','mythic','swift',1,'백조의 목이 휘어지는 곳에 폭풍이 인다.'),
    (112,'corvusroc','Corvusroc','void','mythic','assassin',1,'까마귀 깃 사이에서 눈 하나가 뜬다.'),
    (113,'sproutswift','Sproutswift','poison','uncommon','swift',0,'새싹이라 얕보면 뿌리까지 후회한다.'),
    (115,'burrbeak','Burrbeak',None,'uncommon','standard',0,'가시 돋친 씨앗처럼 들러붙는다.'),
    (116,'brambleshrike','Brambleshrike','blood','rare','standard',0,'장미 덤불의 값비싼 가시.'),
    (117,'thornowl','Thornowl','poison','epic','standard',1,'가시덤불이 검의 형상을 기억해냈다.'),
    (118,'brackentalon','Brackentalon',None,'rare','standard',0,'고비 빛깔 그대로 벼린 들녘의 검.'),
    (119,'azureswift','Azureswift','ice','uncommon','swift',0,'쪽빛 곡선이 물처럼 흐른다.'),
    (120,'bloomkite','Bloomkite','fire','rare','standard',0,'칼끝에서 불꽃이 꽃봉오리로 맺힌다.'),
    (121,'snowquill','Snowquill','ice','epic','standard',0,'눈송이가 녹지 않고 날에 앉는다.'),
    (122,'groveowl','Groveowl','poison','epic','heavy',0,'숲 하나의 무게로 내리친다.'),
    (123,'twinhawk','Twinhawk',None,'epic','heavy',0,'쌍둥이 날이 같은 곳을 두 번 때린다.'),
    (124,'flareowl','Flareowl','fire','epic','standard',0,'섬광이 지나간 뒤에야 소리가 온다.'),
    (125,'anchorbeak','Anchorbeak','ice','rare','heavy',0,'닻처럼 가라앉고 파도처럼 돌아온다.'),
    (126,'prismroc','Prismroc','gold','mythic','standard',1,'일곱 빛이 한 자루에 갇혔다.'),
    (127,'amethowl','Amethowl','void','rare','standard',0,'자수정 끝이 어둠을 빨아들인다.'),
    (128,'dewswift','Dewswift','ice','uncommon','swift',0,'이슬방울이 마르기 전에 벤다.'),
    (129,'hollykite','Hollykite','poison','rare','standard',0,'붉은 열매는 겨울새의 몫, 가시는 녹의 몫.'),
    (130,'aurewing','Aurewing','wind','rare','standard',0,'금빛 날개깃이 순풍을 부른다.'),
    (131,'cirruswing','Cirruswing','wind','rare','swift',0,'새털구름의 높이에서 떨어진다.'),
    (132,'glintroc','Glintroc','electric','mythic','swift',1,'별빛 스파크가 칼몸을 타고 흐른다.'),
    (133,'tinderquill','Tinderquill','fire','common','swift',0,'부싯깃 하나로 시작되는 들불.'),
    (134,'vanewing','Vanewing','wind','rare','standard',0,'바람개비 깃이 풍향을 읽는다.'),
    (135,'umbralswift','Umbralswift','void','rare','swift',0,'보랏빛 잔상이 반 박자 늦게 도착한다.'),
    (136,'scarbeak','Scarbeak','blood','epic','standard',0,'갈고리 흉터는 평생 남는다.'),
    (137,'grimwing','Grimwing',None,'common','standard',0,'전장의 흙빛을 그대로 입었다.'),
    (138,'slatetalon','Slatetalon',None,'uncommon','heavy',0,'석판처럼 넓고 무겁게 눌러 벤다.'),
    (139,'downswift','Downswift','wind','uncommon','swift',0,'솜털처럼 내려앉아 칼처럼 끝난다.'),
    (140,'toxinhawk','Toxinhawk','poison','epic','standard',0,'유리병 속 초록이 넘칠 듯 출렁인다.'),
    (141,'rusttalon','Rusttalon',None,'uncommon','standard',0,'녹슨 게 아니다, 사냥의 흔적이다.'),
    (142,'sparkquill','Sparkquill','gold','uncommon','assassin',0,'금침이 스칠 때마다 불티가 튄다.'),
    (143,'magmatalon','Magmatalon','fire','epic','heavy',0,'갈라진 틈으로 용암이 비친다.'),
    (144,'gemhawk','Gemhawk','gold','rare','standard',0,'두 보석이 서로의 값을 겨룬다.'),
    (145,'reefwing','Reefwing','blood','uncommon','standard',0,'산호초의 분홍은 경고색이다.'),
    (146,'garnetswift','Garnetswift','blood','rare','swift',0,'석류석 조각이 동맥을 찾는다.'),
    (147,'gildowl','Gildowl','gold','uncommon','standard',0,'흰 바탕에 금테, 야장 에다의 취향.'),
    (148,'nightswift','Nightswift','void','uncommon','swift',0,'밤의 곡선을 그대로 벼렸다.'),
    (149,'bandkite','Bandkite','gold','rare','standard',0,'금띠 세 줄이 계급을 말해준다.'),
    (150,'dirgeowl','Dirgeowl','void','epic','standard',1,'장송곡의 첫 소절로 벼린 검.'),
    (151,'luminkite','Luminkite','gold','epic','standard',0,'금가루 섬광이 눈을 못 뜨게 한다.'),
    (152,'palmswift','Palmswift','poison','uncommon','standard',0,'종려잎이 바람 없이 흔들린다.'),
    (153,'mistshrike','Mistshrike','ice','rare','standard',0,'안개가 걷히면 이미 끝나 있다.'),
    (154,'brandowl','Brandowl','fire','epic','standard',0,'사슬에 감긴 불씨가 몸부림친다.'),
    (156,'stormswift','Stormswift','electric','rare','swift',0,'정전기가 깃털처럼 곤두선다.'),
    (157,'clawbeak','Clawbeak','void','uncommon','standard',0,'세 발톱이 한 상처를 낸다.'),
    (158,'ribbonquill','Ribbonquill','blood','uncommon','standard',0,'분홍 리본의 매듭은 풀리지 않는다.'),
    (159,'rippletalon','Rippletalon',None,'uncommon','standard',0,'물결날이 상처를 넓힌다.'),
    (160,'lanternroc','Lanternroc','fire','legendary','standard',0,'등불의 눈이 어둠 속 사냥감을 비춘다.'),
    (161,'broadfinch','Broadfinch',None,'common','standard',0,'넓적한 날이 수풀을 헤친다.'),
    (162,'thicketwing','Thicketwing','poison','rare','standard',0,'덤불 속 장미가 미끼다.'),
    (163,'barbtalon','Barbtalon',None,'rare','standard',0,'미늘이 박히면 빠지지 않는다.'),
    (164,'petalfinch','Petalfinch','poison','common','orbital',0,'흰 꽃잎이 지기 전에 돌아온다.'),
    (165,'sterlingkite','Sterlingkite',None,'rare','standard',0,'은세공 장인의 마지막 작품.'),
    (166,'harvestkite','Harvestkite','gold','rare','standard',0,'밀이삭이 금빛으로 여무는 계절의 검.'),
    (167,'maplewing','Maplewing','fire','uncommon','standard',0,'단풍잎이 타면서 떨어진다.'),
    (168,'larkquill','Larkquill','wind','rare','standard',0,'종달새 울음을 닮은 검명(劍鳴).'),
    (169,'zephyrhawk','Zephyrhawk','wind','epic','standard',0,'산들바람의 탈을 쓴 돌풍.'),
    (170,'dreadtalon','Dreadtalon','void','epic','heavy',0,'붉은 심이 박힌 검은 위압.'),
    (171,'crimsonroc','Crimsonroc','blood','mythic','heavy',1,'피가 마르지 않는 날개.'),
    (172,'tinkertalon','Tinkertalon',None,'epic','standard',0,'접이식 날 여덟 개, 전부 진심이다.'),
    (173,'spirefinch','Spirefinch',None,'common','standard',0,'첨탑 끝처럼 곧은 창날.'),
    (174,'orchidshrike','Orchidshrike','blood','rare','standard',0,'난초 향에 섞인 쇠 냄새.'),
    (175,'fallowbeak','Fallowbeak',None,'common','standard',0,'묵정밭 빛깔의 무던한 대검.'),
    (176,'cosmoroc','Cosmoroc','void','mythic','standard',1,'칼몸 안에서 별자리가 돈다.'),
    (177,'grindroc','Grindroc',None,'mythic','heavy',1,'맞물린 톱니가 멈추지 않는다.'),
    (178,'wispwing','Wispwing','wind','rare','swift',0,'흩날리는 은빛 잔깃.'),
    (179,'runetalon','Runetalon','fire','rare','standard',0,'룬 사슬이 달아오르면 놓아줄 때다.'),
    # 2026-09-01 번개 보강 3종 — 시트 31번째 행(프레임 180~182)은 기존 무원소 검
    # 69·70·82 를 번개 팔레트로 스왑한 것이다 (scripts/add-electric-swords.py).
    (180,'sparkfinch','Sparkfinch','electric','uncommon','swift',0,'깃털 끝마다 잔불꽃 대신 잔전류가 튄다.'),
    (181,'arcshrike','Arcshrike','electric','rare','assassin',0,'한 번 그은 자리에 파란 금이 오래 남는다.'),
    (182,'thunderowl','Thunderowl','electric','epic','heavy',0,'날개를 접고 나서야 천둥이 뒤늦게 따라온다.'),
    # 거동 아키타입 대표 검 (2026-09-01, scripts/add-behavior-swords.py).
    # behavior 필드는 이 생성기가 붙이지 않는다 — 그 스크립트가 얹는다.
    (183,'curlewing','Curlewing','wind','uncommon','swift',0,'던져 놓고 손을 펴고 기다리면, 반드시 제 손으로 돌아온다.'),
    (44,'ringtalon','Ringtalon','electric','epic','swift',0,'지나간 자리마다 파란 고리가 하나씩 남는다.'),
    (184,'stakebeak','Stakebeak','blood','uncommon','heavy',0,'한 번 박히면 뽑을 때까지 피가 멈추지 않는다.'),
    (87,'cairnowl','Cairnowl','void','epic','heavy',0,'돌무지처럼 꽂혀 제 둘레의 빛을 천천히 삼킨다.'),
    (185,'lancequill','Lancequill','electric','uncommon','assassin',0,'한 줄로 늘어선 것들을 한 번에 꿴다.'),
    (101,'pikehawk','Pikehawk','ice','epic','assassin',0,'찌른 자리에서부터 서리가 곧게 뻗어 나간다.'),
    # 아키타입 확대 2차 (2026-09-01, scripts/add-archetype-swords.py).
    # 시트의 마지막 빈칸 3개 — 이걸로 186프레임을 한 칸도 남기지 않고 전부 쓴다.
    (114,'gyrefinch','Gyrefinch','ice','uncommon','swift',0,'서리 호가 한 바퀴를 돌아 제자리로 온다.'),
    (155,'pylonbeak','Pylonbeak','blood','rare','heavy',0,'박아 넣은 자리를 중심으로 붉은 웅덩이가 넓어진다.'),
    (108,'aurumshrike','Aurumshrike','gold','rare','assassin',0,'금빛 궤도 하나에 늘어선 것들이 전부 꿰인다.'),
]

# 신규 조합 레시피 15종 (기존 11종 뒤에 추가)
NEW_RECIPES = [
    (['tidequill', 'dewswift'], 'wavetalon'),
    (['hornbeak', 'stingshrike'], 'gorequill'),
    (['sporefinch', 'sproutswift'], 'thornowl'),
    (['songquill', 'larkquill'], 'dirgeowl'),
    (['gold', 'solroc'], 'aurichawk'),
    (['rimehawk', 'snowquill'], 'borealroc'),
    (['solarkite', 'flareowl'], 'haloroc'),
    (['plumehawk', 'zephyrhawk'], 'swanroc'),
    (['obsidian', 'ashenowl'], 'corvusroc'),
    (['regalkite', 'aegiskite'], 'prismroc'),
    (['violet', 'stormswift'], 'glintroc'),
    (['carrionowl', 'redowl'], 'crimsonroc'),
    (['dreadtalon', 'shardowl'], 'cosmoroc'),
    (['twinhawk', 'bulwarkbeak'], 'grindroc'),
    (['acidswift', 'toxinhawk'], 'mossroc'),
]

ELEMENT_TINT = {
    'fire': '#d9702e', 'ice': '#8fc3d8', 'electric': '#63b3d9', 'poison': '#84b04a',
    'void': '#8d7bb5', 'gold': '#d9a83c', 'blood': '#c9455a', 'wind': '#9fd8c0', None: '#aebfc9',
}
ELEMENT_EFFECT = {
    'fire': 'ember', 'ice': 'trail', 'electric': 'spark', 'poison': 'trail',
    'void': 'flash', 'gold': 'flash', 'blood': 'slash', 'wind': 'trail', None: 'slash',
}
MAGIC_ELEMENTS = {'fire', 'ice', 'electric', 'poison', 'void'}

ARCH = {
    'orbital': dict(mult=0.45, cd=300, hits=3, orbit=1.15, ls=0),
    'swift': dict(mult=0.70, cd=800, hits=2, orbit=1.05, ls=70),
    'standard': dict(mult=1.00, cd=1150, hits=1, orbit=1.0, ls=0),
    'heavy': dict(mult=1.55, cd=1650, hits=1, orbit=0.92, ls=-40),
    'assassin': dict(mult=0.95, cd=1000, hits=1, orbit=1.0, ls=40),
}


def jitter(id_, salt, lo, hi):
    h = int(hashlib.md5((id_ + salt).encode()).hexdigest(), 16)
    return lo + (h % 1000) / 999 * (hi - lo)


def special_for(element, r, id_):
    if element is None or r < R['rare']:
        return None
    if element == 'fire':
        return {'type': 'burn', 'dps': 5 + 3 * r, 'durationMs': 2000, 'label': 'Ignite'}
    if element == 'poison':
        return {'type': 'poison', 'dps': 6 + 3 * r, 'durationMs': 2500, 'label': 'Venom'}
    if element == 'ice':
        return {'type': 'slow', 'slowPct': round(0.3 + 0.05 * r, 2), 'durationMs': 1400 + 100 * r, 'label': 'Chill'}
    if element == 'electric':
        return {'type': 'chain', 'targets': 1 + (1 if r >= 4 else 0), 'damagePct': round(0.5 + 0.05 * r, 2), 'label': 'Arc'}
    if element == 'gold':
        return {'type': 'midas', 'chance': round(0.12 + 0.03 * r, 2), 'label': 'Midas'}
    if element == 'void':
        return {'type': 'execute', 'threshold': round(0.08 + 0.02 * r, 2), 'label': 'Null'}
    if element == 'blood':
        return {'type': 'leech', 'chance': 0.35, 'damagePct': round(0.2 + 0.05 * r, 2), 'label': 'Leech'}
    if element == 'wind':
        return {'type': 'blast', 'radius': 100 + 15 * r, 'damagePct': round(0.45 + 0.05 * r, 2), 'label': 'Gust'}
    return None


def hitbox_for(frame, sheet):
    fx, fy = (frame % 6) * 32, (frame // 6) * 32
    box = sheet.crop((fx, fy, fx + 32, fy + 32)).getbbox()
    if not box:
        return {'width': 20, 'height': 20, 'offsetX': 6, 'offsetY': 6}
    w = max(14, min(26, round((box[2] - box[0]) * 0.72)))
    h = max(14, min(26, round((box[3] - box[1]) * 0.72)))
    return {'width': w, 'height': h, 'offsetX': round((32 - w) / 2), 'offsetY': round((32 - h) / 2)}


def build_entry(frame, id_, name, element, rarity, arch, evolved, lore, sheet):
    r = R[rarity]
    a = ARCH[arch]
    dmg_base = [16, 24, 33, 45, 60, 80][r]
    damage = max(4, round(dmg_base * a['mult'] * jitter(id_, 'dmg', 0.92, 1.08)))
    cooldown = round(a['cd'] * (1 - 0.03 * r) * jitter(id_, 'cd', 0.95, 1.05) / 10) * 10
    launch = round((350 + r * 25 + a['ls'] + jitter(id_, 'ls', -15, 15)) / 5) * 5
    if arch == 'assassin':
        crit, crit_mult = round(0.25 + 0.02 * r, 2), round(1.9 + 0.1 * r, 2)
    else:
        crit, crit_mult = round(0.08 + 0.015 * r, 3), round(1.5 + 0.05 * r, 2)
    hits = a['hits'] + (1 if arch in ('standard', 'heavy') and r >= 4 else 0)
    damage_type = 'magic' if element in MAGIC_ELEMENTS else 'physical'

    e = {
        'id': id_, 'name': name, 'assetName': 'swords.png', 'sheetOrder': frame,
        'orbitSpeedMultiplier': a['orbit'], 'launchSpeed': launch, 'damage': damage,
        'cooldownMs': cooldown, 'maxHits': hits, 'critChance': crit,
        'critDamageMultiplier': crit_mult,
        'effect': {'type': ELEMENT_EFFECT[element], 'tint': ELEMENT_TINT[element]},
        'hitbox': hitbox_for(frame, sheet), 'damageType': damage_type, 'rarity': rarity,
    }
    if element:
        e['element'] = element
    if r >= R['rare']:
        pen = round(0.1 + 0.05 * (r - 2), 2)
        e['physicalPen' if damage_type == 'physical' else 'magicPen'] = pen
    sp = special_for(element, r, id_)
    if sp:
        e['special'] = sp
    if r == R['legendary']:
        e['trueDamage'] = 8 + round(jitter(id_, 'td', 0, 6))
    if r == R['mythic']:
        e['trueDamage'] = 14 + round(jitter(id_, 'td', 0, 8))
        e['maxHpDamage'] = 0.015
    if evolved:
        e['evolved'] = True
    e['lore'] = lore
    return e


def main():
    sheet = Image.open(SHEET).convert('RGBA')
    existing = json.load(open(CATALOG, encoding='utf-8'))
    by_id = {e['id']: e for e in existing}
    catalog = []
    # 기존 19종: 스탯 보존, rarity·assetName만 갱신
    for e in existing:
        if e['id'] not in EXISTING_RARITY:
            continue  # 이전 생성분 제거 (재실행 안전)
        e = dict(e)
        e['rarity'] = EXISTING_RARITY[e['id']]
        e['assetName'] = 'swords.png'
        catalog.append(e)
    known = {e['id'] for e in catalog}
    names = {e['name'] for e in catalog}
    for (frame, id_, name, element, rarity, arch, evolved, lore) in T:
        assert frame not in EXCLUDED, frame
        assert id_ not in known, id_
        assert name not in names, name
        known.add(id_); names.add(name)
        catalog.append(build_entry(frame, id_, name, element, rarity, arch, evolved, lore, sheet))

    # 프레임 중복/제외 검증
    frames = [e['sheetOrder'] for e in catalog]
    assert len(frames) == len(set(frames)), 'duplicate frame'
    assert not (set(frames) & EXCLUDED), 'excluded frame used'

    json.dump(catalog, open(CATALOG, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    evo = json.load(open(EVOCAT, encoding='utf-8'))
    evo = [r for r in evo if r['result'] in EXISTING_RARITY]  # 기존 11종 유지 (재실행 안전)
    for ingredients, result in NEW_RECIPES:
        for ing in ingredients:
            assert ing in known, ing
        assert result in known, result
        evo.append({'ingredients': ingredients, 'result': result,
                    'announcement': f'조합 성공 — {next(e["name"] for e in catalog if e["id"] == result)}'})
    json.dump(evo, open(EVOCAT, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    from collections import Counter
    print('swords:', len(catalog), 'recipes:', len(evo))
    print('rarity:', dict(Counter(e['rarity'] for e in catalog)))
    print('element:', dict(Counter(e.get('element', 'none') for e in catalog)))
    print('evolved:', sum(1 for e in catalog if e.get('evolved')))


if __name__ == '__main__':
    main()
