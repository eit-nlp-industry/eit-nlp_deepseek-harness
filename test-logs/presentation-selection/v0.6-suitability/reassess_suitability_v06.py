"""Rate requirement/presentation fit independently of observed generation reliability."""
from pathlib import Path
from collections import Counter
import json,csv,hashlib,statistics,zipfile,re

BASE=Path('C:/Users/CJY/.codex/visualizations/2026/11/18/01a1ede2-d2d9-7603-a35c-f4b22a5e8e4a/campus-benchmark')
OLD=BASE/'v0.5-formal'; OUT=BASE/'v0.6-suitability'; OUT.mkdir(exist_ok=True)
def load(p):return json.loads(p.read_text('utf8'))
def dump(name,value):(OUT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n','utf8')
def md(name,lines):(OUT/name).write_text('\n'.join(lines)+'\n','utf8')
plan=load(OLD/'confirmed-plan.json'); old=load(OLD/'results-index.json')
cards={x['id']:x for x in plan['cards']}; cats={x['id']:x for x in plan['categories']}
dimensions=[('coverage','需求覆盖',35),('operation','操作方式匹配',25),('review_edit','核对与修改便利',20),('organization','信息组织',10),('necessity','使用负担与必要性',10)]
# A is the least elaborate native combination sufficient for the requirement;
# J is a correctly working, minimally composed dynamic UI, not a replay of v0.5 defects.
profiles={
 'short':([5,5,5,5,5],[5,5,5,5,2],['无额外输入或编辑要求，直接文字即可完整满足','动态卡片也能表达同样内容，但没有新增浏览/编辑能力']),
 'choice':([5,5,5,5,5],[5,5,5,5,2],['原生单选/多选/自由回答已覆盖一次选择与提交','轻量动态表单也能完成，但没有业务整单编辑价值']),
 'preferences':([5,5,4,4,5],[5,5,5,5,4],['原生多题能收齐偏好；跨题回看修改略分散','一页集中核对三项更便利，但本例没有正式业务草稿或复杂联动']),
 'three_questions':([5,5,5,5,5],[5,5,5,5,4],['三个独立未知信息，原生多题即可收齐，不需要整单反复编辑','三字段一页填写也适合；优势尚不足以要求专用业务表单']),
 'intro_images':([5,4,5,4,5],[5,5,5,5,4],['分节与三张原生图片足够读完；持续来回浏览稍分散','Tabs可在地点之间直接切换，信息密度高时更清楚']),
 'browse':([5,3,5,3,5],[5,5,5,5,4],['文字能完整给出资料，但按需详情依靠长文或再次追问','明确需要概览后自主看详情，Tabs/Collapsible直接匹配浏览目标']),
 'compare':([5,5,5,5,5],[5,5,5,5,3],['少量固定候选，一张Markdown比较表及理由即可','动态Table也适用，但没有改筛选条件或探索数据的要求']),
 'image_confirm':([5,5,5,5,5],[5,5,5,5,3],['原生图片先给证据，原生问题接一次确认，能力已足够','Image加确认也能满足，但不需要额外业务表单或图像操作']),
 'image_notice':([5,5,5,5,5],[5,5,5,5,3],['已有图片/状态通知，原生图文即可表达；没有用户输入','动态Image/卡片可展示相同信息，但不新增必要交互']),
 'image_recommend':([5,5,5,5,5],[5,5,5,5,3],['两处固定观察和推荐，用原生图片及短说明便于直接对照','推荐卡与图片同样适合，但本例不需要用户切换条件']),
 'two_views':([5,5,5,5,5],[5,5,5,5,4],['只有左右两图，时间/视角标注后并列核对最直接','最小动态图组也可并列满足；原生能力已够，引入动态组件新增价值较小']),
 'three_views':([5,4,5,5,5],[5,5,5,5,4],['三张原生图可并列核对，往返查找略多','动态呈现可按核对方式选择图组或Tabs；不能把Tabs隐藏其他图当作必然最优']),
 'business_form':([5,3,3,4,4],[5,5,5,5,4],['能通过对话完整完成，但日期/人数/备注等整单回看和局部修改分散','预填业务字段，集中核对/编辑后提交，DynamicForm有明确价值']),
 'revise_form':([5,4,3,4,5],[5,5,5,5,4],['自然语言可一次改多个值，但完整草稿回看与再编辑仍分散','已有多字段草稿，保留未改字段并展示可编辑修订稿更合适']),
 'conflict_form':([5,4,3,4,4],[5,5,5,5,4],['取消设备、改时间、冲突改选可用对话完成，跨字段核对较费力','保留设备/时段等完整修订草稿，约束和可选值集中呈现']),
 'single_slot':([5,5,5,5,5],[5,5,5,5,3],['本例仅改一个时段并在两项中选一项，原生提问已足够','整单表单也能做，但当前操作没有要求重填房间、日期和人数']),
 'evidence_form':([5,3,2,3,4],[5,5,5,5,4],['能完整收齐并提交，但图片、设备、地点、故障、备注和联系人分散在对话，交叉核对成本高','三图证据与多字段反馈单绑定，集中核对、补填及提交更合适']),
 'reorder':([5,3,2,4,5],[5,5,5,5,4],['文字能完整描述并保存目标顺序，但不能直接操控列表和试排','直接重排、保持全部条目、应用新顺序匹配方案调整目标']),
 'static_map':([5,5,5,5,5],[5,5,5,5,3],['本例只需看同一静态底图和两段路线，原生图文已足够','MapPreview有缩放/点位组织价值，但本例未要求交互探索或实时定位']),
 'state_photo':([5,5,5,5,5],[5,5,5,5,3],['少量阶段状态与一张证据图，图文回执足够','状态卡可用，但没有持续操控面板或多任务对照要求']),
 'event_notice':([5,5,5,5,5],[5,5,5,5,2],['用户要事件发生时通知或一句控制回执，文字最直接','没有持续看板要求，动态界面不带来必要操作']),
 'job_monitor':([5,5,4,4,5],[5,5,5,5,4],['只监测一个任务、失败通知和对话控制，原生可完成；历史回看较分散','统一进度和时间线便于回看，持续查看时更合适；本例仍非必须']),
 'workflow':([5,3,3,3,4],[5,5,5,5,4],['文字能完整改步骤和条件，但不能直接编辑节点、整体检查后再保存','Workflow把步骤、参数、分支与保存置于同一编辑对象']),
 'branch_workflow':([5,3,2,3,4],[5,5,5,5,4],['条件分支与回流可完整用文字说明，但局部修改和跨路径核对困难','直接编辑分支、回看完整路径并保存，交互收益明确']),
}
# Rating scope comes from user input plus the confirmed task script, not from
# the arm-specific tool instructions that prescribed Tabs/Map/Workflow.
decisions={
 'C01':('intro_images','conditional','原生图文分节；持续按地点浏览时用Tabs','三地点配三图，一次介绍原生已够；需要反复切换详情时动态更有价值。'),
 'C02-a':('short','text','文字/Markdown','单地点讨论空间与进入条件的直接问答，没有额外操作。'),
 'C02-b':('short','text','文字/Markdown','只回答进入条件，不应为一句说明生成表单。'),
 'C03':('compare','text','Markdown比较表+推荐理由','候选少且条件已给定；质疑推荐时解释硬条件，不应自动弹预约表。'),
 'C04-a':('choice','native','DSH原生提问','只缺用途，一个自由回答或少量选项即可补齐。'),
 'C04-b':('preferences','conditional','默认原生多题；反复改偏好时用轻量表单','上午/下午、多选地点、补充文字是偏好采集，尚无正式业务整单；集中回看时动态略占优。'),
 'C04-c':('choice','native','DSH原生单选','线上或线下二选一，推荐预选与实际提交分开即可。'),
 'C05':('business_form','json_render','json-render预约表单','本卡脚本进入日期、时段、人数、备注的预约草稿核对与提交；初始只咨询手续时先文字解释。'),
 'C06':('revise_form','json_render','json-render修订后的预约草稿','已有预约需同时改时段、行程和备注并核对整单；仅报知一次修改结果时不必重绘全表。'),
 'C07-a':('conflict_form','json_render','json-render整单修改；原生询问是否接受替代','取消白板、改变时间并处理冲突涉及修订草稿；偏离晚间的下午选项必须另获用户选择。'),
 'C07-b':('choice','native','DSH原生替代选项；拒绝后文字回执','本分支最终只需确认是否接受下午；用户拒绝后停止，不再强迫填写预约表。'),
 'C08':('image_confirm','native','原生图片+身份确认','确认一个候选是否本人，不需要业务多字段表单。'),
 'C09':('image_notice','native','原生图片+简短通知','环境触发的重逢通知，没有新用户输入需要收集。'),
 'C10':('state_photo','native','原生图片确认+文字跟随状态','确认向导后接收跟随/丢失/停止回执，不需要生成机器人控制面板。'),
 'C11':('event_notice','text','简短文字控制回执','暂停与继续的指令已由用户给出，不再额外询问同一意图。'),
 'C12':('image_confirm','native','原生候选图+必要确认','图中两名候选中确认灰衣拉箱者，原生选择足够。'),
 'C13':('image_recommend','native','原生证据图+简短推荐','固定两处观察证据足以解释安静地点推荐，没有交互筛选需求。'),
 'C14':('two_views','native','原生左右图对照；动态并列图组可选','只有左/右两张、不同时间的证据；视角时间标签比Tabs本身更重要。'),
 'C15':('image_confirm','native','逐次原生图片+对象确认','远近侧三次追加证据，最后确认同一外卖；不是填写取件业务表。'),
 'C16':('state_photo','native','原生文件图+确认和交接回执','确认一份文件及交接阶段，不需要Workflow或业务表单。'),
 'C17-a':('event_notice','text','一次开门文字通知；有证据时附原生图','观察五分钟的通知型需求，不等于用户要持续操作看板。'),
 'C17-b':('event_notice','text','到期文字总结','到期未开门只需说明观察结果和监测结束。'),
 'C18':('state_photo','native','原生补拍图+停止/返回状态','一次补拍和停止/返回反馈，保持阶段清楚即可。'),
 'C19':('reorder','json_render','json-render SortableSequence','该卡包含用户调整并保存顺序，直接试排与整体核对有价值；只要一次固定排序结果时文字即可。'),
 'C20':('static_map','native','固定原生地图+路线文字；交互地图另列条件','原题只作静态三点两段示意，没有点选、路线切换或实时位置需求。'),
 'C21':('state_photo','native','原生门图+停止原因','受阻原因和停止状态是回执，不因涉及导航就必须上地图。'),
 'C22':('evidence_form','json_render','先原生看图；报修阶段json-render证据表单','拍一张图阶段无需表单；三图、设备、地点、故障、备注及联系人一起核对提交时表单收益明确。'),
 'C23':('workflow','json_render','json-render Workflow编辑器','需求已进入可复用流程编辑，修改等待参数并保存草稿，适合直接编辑对象。'),
 'C24':('branch_workflow','json_render','json-render Workflow条件分支编辑','对已存流程增添不在场分支，需要回看在/不在两条完整路径。'),
 'C25-a':('short','text','简短文字成功回执','单动作模拟成功，最终答案无需让用户再操作。'),
 'C25-b':('short','text','简短文字失败回执','单动作失败及原因，动态卡片没有必要交互。'),
 'C26':('short','text','一句话条件说明','明确要求简短，保留预约和批准条件即可。'),
 'N01':('short','text','简短支付状态文字','支付成功与结算待处理是两条事实，不需要表单或状态看板。'),
 'N02':('browse','json_render','json-render Tabs/Collapsible','用户明确先概览、再自主按需看套餐范围与限制，切换/展开有直接用途。'),
 'N03':('compare','text','Markdown比较表+筛选理由','四个固定候选、固定预算重量与续航优先级，不需要尚未要求的交互筛选器。'),
 'N04':('three_questions','native','DSH原生三题；一页轻量form也可','只收用途、人数、形式然后汇总，不创建可反复修改提交的业务申请单。'),
 'N05':('image_confirm','native','原生包裹图+是否确认','一张图和一个是/否确认，不应升级成复杂表单。'),
 'N06':('three_views','conditional','原生并列图或Tabs；按核对方式选择','三个视角各有价值；同时比较选并列，逐角看细节选Tabs。退货意向仍用原生确认。'),
 'N07':('business_form','json_render','json-render售后申请表+附件','订单、故障、联系人和照片关联一起预填、核对、改联系人并提交，属于业务整单编辑。'),
 'N08':('single_slot','native','原生替代时段选择；整单编辑时再用json-render','本例仅改时段，日期房间人数已确定；冲突后只有两项可选，原生选择足够。'),
 'N09':('reorder','json_render','json-render SortableSequence','明确让用户调整和保存工作顺序，直接操控列表比反复描述位置更合适。'),
 'N10':('static_map','native','原生静态平面图+两段路线','仅说明给定三点和静态路线，没有地图探索操作，不能凭Map组件名称加分。'),
 'N11':('job_monitor','conditional','默认文字通知；需要持续回看时用状态卡/时间线','一个任务的失败通知及对话控制原生可满足；长期停留看进度/历史时动态看板更有收益。'),
 'N12':('branch_workflow','json_render','json-render Workflow分支与期限编辑','要编辑报销流程、材料不齐回补分支和3工作日期限并保存，适合直接操作流程对象。'),
}
assert set(decisions)=={c['case_id'] for c in plan['cases']}
rows=[]
for case in plan['cases']:
    cid=case['case_id']; profile,route,recommendation,reason=decisions[cid]
    av,jv,basis=profiles[profile]
    record={**{k:case[k] for k in ['case_id','card_id','category_id','input','actions','scenario_domain']},'title':cards[case['card_id']]['title'],'profile':profile,'recommendation_class':route,'recommendation':recommendation,'case_reason':reason,'scope':'input_and_confirmed_business_script_not_arm_specific_component_prescription','scores':{},'v05_reference_run_ids':[r['run_id'] for r in old if r['case_id']==cid]}
    for arm,vector,why in [('A_native',av,basis[0]),('J_json_render',jv,basis[1])]:
        score=sum(v*w/5 for v,(_,_,w) in zip(vector,dimensions))
        record['scores'][arm]={'dimensions':{d[0]:v for d,v in zip(dimensions,vector)},'weighted_score':int(score),'reason':why,'assumption':'correctly_working_minimal_presentation_not_observed_generation'}
    record['delta_J_minus_A']=record['scores']['J_json_render']['weighted_score']-record['scores']['A_native']['weighted_score']
    rows.append(record)
dump('评分明细.json',{'version':'0.6-suitability','assessment_kind':'expert_requirement_fit_reassessment_not_new_execution','created_date':'2026-11-24','case_count':44,'scores_per_case':2,'weights':[{ 'id':k,'label':label,'weight':w} for k,label,w in dimensions],'rows':rows})
with (OUT/'评分明细.csv').open('w',encoding='utf-8-sig',newline='') as f:
    keys=['case_id','category_id','scenario_domain','arm']+[d[0] for d in dimensions]+['weighted_score','recommendation_class','recommendation','reason']
    writer=csv.DictWriter(f,fieldnames=keys);writer.writeheader()
    for r in rows:
        for arm,s in r['scores'].items():writer.writerow({k:r[k] for k in ['case_id','category_id','scenario_domain']}|{'arm':arm}|s['dimensions']|{'weighted_score':s['weighted_score'],'recommendation_class':r['recommendation_class'],'recommendation':r['recommendation'],'reason':s['reason']+'；'+r['case_reason']})
dump('v0.5运行质量参考.json',{'role':'reference_only_excluded_from_suitability_scores','primary_runs':176,'rows':old})
source_hashes={name:hashlib.sha256((OLD/name).read_bytes()).hexdigest() for name in ['confirmed-plan.json','results-index.json','scores.json','aggregates.json']}
categories=[]
for gid,c in cats.items():
    rs=[r for r in rows if r['category_id']==gid]
    categories.append({'category_id':gid,'title':c['title'],'case_count':len(rs),'A_mean':round(statistics.mean(r['scores']['A_native']['weighted_score'] for r in rs),2),'J_mean':round(statistics.mean(r['scores']['J_json_render']['weighted_score'] for r in rs),2),'recommendation_counts':dict(Counter(r['recommendation_class'] for r in rs))})
dump('分类汇总.json',categories)
rules=[
 ('R01','直接文字','短问答、单次成功/失败回执、理由解释、少量固定比较','C02-a/C02-b/C03/C11/C17-a/C17-b/C25-a/C25-b/C26/N01/N03','没有新的输入、探索或编辑目标，直接输出事实或Markdown表。不要为了排版增加交互。'),
 ('R02','DSH原生提问','是否确认、是/否、少量单选、多选、一个用途或缺失字段','C04-a/C04-c/C08/C12/N05','用户只要作一次选择或补少量独立信息，使用ask_user_question；推荐预选不视为确认。'),
 ('R03','DSH原生图文','单图对象确认、两图对照、逐次补拍、导航受阻回执','C09/C10/C13/C14/C15/C16/C18/C21','需要看证据不等于需要动态组件。先让图片可见，再用原生确认；时间/视角/对象标签保留。'),
 ('R04','json-render DynamicForm','预约、售后、报修等整单预填—核对—修改—提交','C05/C06/C07-a/C22/N07','多个业务字段构成同一草稿，用户需整单检查、局部修改、保留未改字段或关联附件时优先使用。字段数量不是唯一条件。'),
 ('R05','json-render Tabs/Collapsible','概览后由用户自主浏览分类、套餐、分层详情','N02；C01条件适用','用户明确需要按需展开/来回切换时使用。短篇介绍直接分节；两张图需同时比较时并列更合适。'),
 ('R06','json-render SortableSequence','用户直接调整顺序、连续试排、整体核对后应用','C19/N09','直接操作列表有明确收益。若只让模型给一次固定排序答案，用有序文字列表即可。'),
 ('R07','json-render Workflow','用户直接编辑步骤、参数、条件分支并保存流程草稿','C23/C24/N12','流程成为要编辑和复用的对象时优先使用；只是解释流程步骤时用文字。视觉编辑不代替业务条件审计。'),
 ('R08','地图按操作需求分流','静态看位置/路线：原生图文；缩放、点位探索、路线切换：动态地图','C20/N10仅覆盖静态；交互扩展未评分','现有静态卡不证明交互地图优势。MapPreview缩放/点位是接入能力；点选详情、路线切换和实时定位须有相应能力与数据，不能凭此规则假定已实现。'),
 ('R09','状态按查看方式分流','一次通知/控制回执：文字；持续查看进度历史或多任务状态：动态看板','C11/C17/C18/N11','后台任务和实时数据由工具/事件提供，组件只负责展示或提交控制意图，不凭卡片外观增加执行能力。'),
 ('R10','按阶段组合','先解释→表单编辑→一次确认→回执','C05/C22/N07/N08','不要给整段会话固定一种呈现。复杂预约填单用json-render，但单独询问是否提交用原生提问，提交结果用文字；已有表单自带明确提交按钮时不要再重复增加确认。'),
]
rules_md=['# 选型规则与阶段示例 v0.6','','本文件依据44个已有需求及确认动作脚本作专家适配度判断。旧176次生成记录仅作实现参考；此处不是新增实测、用户效率实验或已发布Skill。','', '|规则|建议方式|需求判断|案例依据|', '|---|---|---|---|']
for rid,mode,need,evidence,detail in rules:rules_md += [f'|{rid}|{mode}|{need}|{evidence}|']
for rid,mode,need,evidence,detail in rules:rules_md += ['',f'**{rid} {mode}**：{detail}']
rules_md += ['','## 预约：不是看到“预约”就弹表单','','|需求阶段|推荐呈现|为什么|','|---|---|---|', '|“参观需要提前办什么？”|文字说明|先回答手续和已知条件，尚未进入填单|', '|“帮我填写预约，日期、时段、人数、备注需要核对修改”|json-render预约表单|同一业务对象的预填、整单核对和局部编辑|', '|“16–17点满了，17–18或18–19选哪个？”|DSH原生单选|仅剩一个字段和两项真实可选值；N08不必重填全单|', '|“是否按这份草稿提交？”|DSH原生确认，或现有表单的提交按钮|只有一次明确决策，不另建复杂表单|', '|“已收到草稿/提交失败”|简短文字回执|回执不是再次收集信息|', '', '## 报修：同一任务可以逐步升级呈现','','C22 的“先拍一张照片”使用原生图片；“把三张照片放入反馈单，补联系人并修改备注”切换为json-render证据表单；提交后的受理回执回到简短文字。不能因为最终有报修单，就在第一张照片前抢先弹表单。','','## 多视角和地图：先问用户需要怎么读','','两图左右对照优先并列；多类别自主浏览适合Tabs；逐次补拍不必每次生成一套Tabs。静态三点两段路线用已有地图加文字即可；若要求缩放、点击点位查看信息或切换路线，才需要具有这些操作的动态地图。后两项在原44例中没有验证，不能写成已实测支持。','','## 待扩展需求（未纳入本次评分）','','|需求|预期适用方式|还需确认|','|---|---|---|', '|多字段预约含条件显隐、联动约束和重复访客条目|动态业务表单|当前目录是否支持对应控件/联动及业务数据来源|', '|自主点选地图地点、看详情并切换路线|动态地图|点位事件、详情、路线切换是否有实际组件接口|', '|改比较条件后自主筛选多条候选|交互筛选表格|本地/后端筛选引擎不能从Table名称推定|', '|持续监测多任务并在同一面板控制|动态状态看板|控制意图回传和任务状态数据接口|', '', '这些是根据需求推导的扩展方向，不产生新的运行次数或分数。']
md('选型规则与阶段示例.md',rules_md)
method=['# 评分规则与边界 v0.6','','目标是判断“这个需求是否值得使用交互组件，以及哪种呈现方式适合”，不评价本次模型是否成功生成、当前接入是否稳定。v0.5的事实正确性、生成失败、未注册组件、按钮断链、超时、状态残留和重复输出仍可查阅，但全部排除出本版主分。','','本版是需求层面的专家复评：44个独立需求各评A/J一次，共88个方式适配度评分；不是重跑176次，也不是把两次运行重复计为适配度证据。评分由单一评估者根据输入、确认动作脚本与能力清单判断，未盲评、未作独立评分者校准，不是用户行为实验，分数不代表成功概率、用户满意度百分比或实测节省点击/时间。','','A为满足需求的最简DSH原生组合（文字/Markdown、图片/预览、原生问题），J为正常工作的最小充分json-render组合。A不等于只允许纯文字。J不沿用旧输出里的冗余表格、错误事件和注册错误，也不凭空假定有未接入的筛选、地图详情或实时控制能力。两者都使用相同业务事实、工具及后端结果，不把后端能力算给呈现组件。','','## 新主分：需求适配度','','本版权重由评估者依据本次请求设定，并非旧版60/25/15权重，也不声称已通过用户实验校准。','', '|维度|权重|评估内容|', '|---|---:|---|', '|需求覆盖|35%|所需展示、选择、编辑和结果核对能否直接支持；不按旧生成的事实错误扣分|', '|操作方式匹配|25%|直接点击/修改/排序/浏览是否符合用户本来要做的事；无操作需求时直接阅读同样可满分|', '|核对与修改便利|20%|需要修改时能否整单查看并局部改动，或自主试排/编辑；无修改要求不强行扣分|', '|信息组织|10%|是否便于比较、分层查看、理解空间或分支；Tabs不总比并列更合适|', '|使用负担与必要性|10%|新增专用UI是否有必要，是否与现成原生能力重复；不计生成耗时、故障率或接入稳定性|', '', '各项0–5，总分=需求覆盖×7+操作匹配×5+核对修改×4+信息组织×2+必要性×2。','', '|分值|共同锚点|','|---:|---|', '|5|直接充分满足该维度的实际需求；无需额外能力的场景也可得5|', '|4|满足主要需求，有轻微阅读/操作/组织折衷|', '|3|可通过替代方式完成，或专用组件有用但新增价值有限|', '|2|依赖明显的对话替代、跨处核对，或引入专用UI几乎无新增价值|', '|1|与所需操作明显不匹配，主要能力缺失|', '|0|该方式无法支持关键需求|', '', '必要性维度针对“是否值得引入这种呈现”，不把多点点击数或一次工具调用当作已测开销。必要性只占10%，因此简单场景中两种方式都可能高分，仍可基于原生已足够而推荐原生。不能因出现按钮就加分，也不能因没有按钮就扣分。','','## 如何给出推荐','','分差达到8分且与具体需求一致时，用作明显适配度方向；不足8分作为近似适配，不将细微数字差当显著优势，优先最小充分的原生方式或按查看偏好选择。8分是本版的解释阈值，不是统计显著性，也不保证换一位评分者仍保持分差。每例保留理由和五项原始分，不能只看总分。','','用户输入、确认动作与业务脚本决定需求范围；不把旧B臂提示里“必须用Tabs/MapPreview/Workflow”当成用户已经要求该交互，也不因为A臂规定用文字就直接给A满分。一个任务中复杂编辑、简单确认、结果回执分别选型，不把整段会话固定为一种组件。','','## 特别注意','','C05主输入为咨询，但已确认脚本包含预约草稿编辑与提交，所以表单阶段推荐json-render，初始咨询仍用文字。C22主输入只要拍照，后续脚本才进入报修表单，不能一开始就弹表单。N08只修改一个时段，冲突后两项选一，原生足够；不能因为业务叫“预约”就要求全表。C20/N10只要求静态地图，原生图片已能展示，动态探索地图须另加真实需求。C24/N12按流程编辑和跨分支核对判断价值，不把旧版错误路径或没有保存回执算入本版适配度。','','当前44例中没有真正覆盖大规模动态表单、地图点选详情、实时SSE、多任务实时看板、表格自动筛选等交互的用户效果；新增方向只作条件规则，不声称当前已接通。','','## 旧分如何保留','','[v0.5运行质量参考](v0.5运行质量参考.md)保留176次原分、实际呈现和核心验收；[参考JSON](v0.5运行质量参考.json)可追溯Session ID和扣分。它只回答当时生成与接入效果，不与新主分相加、不作平分决胜条件。旧报告和ZIP均不覆盖。','','本版不发布Skill，不修改产品代码或历史Session，不重新调用模型或浏览器。后续可将本版规则和例子整理为Skill，但应把需求适配规则与实现可靠性检查分开。']
md('评分规则与边界.md',method)
detail=['# 44个需求案例：逐项适配度评分','','每例只判断一次需求；A=最简原生组合，J=正常工作的最小充分json-render组合。覆盖/操作/修改/组织/必要性各0–5，总分=7/5/4/2/2倍相加。生成稳定性不计分。','', '|案例|方式|覆盖|操作|修改|组织|必要性|总分|维度依据|','|---|---|---:|---:|---:|---:|---:|---:|---|']
for r in rows:
    for arm,s in r['scores'].items():
        v=list(s['dimensions'].values());detail.append('|'+r['case_id']+'|'+('A原生' if arm=='A_native' else 'J动态')+'|'+'|'.join(map(str,v))+'|'+str(s['weighted_score'])+'|'+s['reason']+'|')
for r in rows:
    a=r['scores']['A_native']['weighted_score'];j=r['scores']['J_json_render']['weighted_score']
    detail+=['',f"## {r['case_id']} {r['title']}",'',f"输入：{r['input']}",'',f"后续动作：{r['actions']}",'',f"适配度：A {a} / J {j}；J−A={j-a:+d}。",'',f"推荐：{r['recommendation']}。",'',f"理由与阶段：{r['case_reason']}",'',f"旧运行参考：{', '.join(r['v05_reference_run_ids'])}，只作质量参考。"]
md('44案例_逐项评分.md',detail)
legacy=['# v0.5运行质量参考（不计入新主分）','','这176次为旧版实际执行数据，不能拿来当新适配度的176个独立判断。以下原分和扣分保留不变；旧F/R/S不是本版五项适配度。','', '|运行|原核心验收|原呈现|原F|原R|原S|原总分|原扣分|','|---|---|---|---:|---:|---:|---:|---|']
for r in sorted(old,key=lambda r:r['run_id']):legacy.append(f"|{r['run_id']}|{r['status']}|{r['presentation']}|{r['factual_completeness']}|{r['readability']}|{r['state']}|{r['weighted_score']}|{r['reason'].replace('|','／')}|")
md('v0.5运行质量参考.md',legacy)
count=Counter(r['recommendation_class'] for r in rows)
category_advice={
 'G01':'直接文字。短问答、动作回执没有必要交互。',
 'G02':'单地点短答用文字；三地点图文可原生，明确按需浏览套餐详情优先Tabs/Collapsible。',
 'G03':'本批少量固定比较用Markdown表；用户要自主改筛选条件时才考虑交互比较界面。',
 'G04':'简单确认、少量偏好优先原生；集中多字段且要反复回改时可用轻量动态表单。',
 'G05':'原生图像+必要确认；是否/是不是不需要业务表单。',
 'G06':'两图并列优先原生；多视角按需查看可用Tabs，需同时对照则并列。',
 'G07':'整单预约/售后/报修，优先json-render DynamicForm；咨询与单次确认分别用文字/原生。',
 'G08':'多字段修订并检查全单优先动态表单；冲突后只选两项或明确拒绝，用原生即可。',
 'G09':'直接重排并应用优先SortableSequence；只要一次排序结果则文字即可。',
 'G10':'现有题均为静态路线或受阻通知，原生图文足够；交互地图的探索需求另行判断。',
 'G11':'一次事件通知/控制回执用文字；持续查看统一进度历史时动态状态卡/时间线更适合。',
 'G12':'步骤说明用文字；直接编辑步骤、参数和条件分支并保存，优先Workflow。',
}
report=['# 组件选型需求适配度重评报告 v0.6','','**本版的主问题：这个需求是否值得使用交互组件？** 旧版生成失败、未注册组件、超时和提交断链不进入新分数，全部保留为独立参考。重点是用户要阅读、选择、填写整单、直接修改、排序、探索位置还是编辑流程。','','**结论：复杂业务表单、按需分类浏览、直接重排、流程节点/分支编辑优先json-render；简单确认和少量选择优先DSH原生；短问答与回执直接文字。地图要区分静态说明与交互探索，不能仅凭组件名称选型。**','','本次复评覆盖原44个独立案例（32校园、12非校园），每例对A原生与J动态各评一次。没有新跑模型，不把原两次重复当成新适配度证据，也不是把原176条输出假装重新测了一遍。以下分数是基于需求的专家判断，不是用户实测效率或成功率。','','## 主分与参考项分开','','|内容|本版用途|','|---|---|','|需求覆盖35%、操作方式匹配25%、核对修改20%、信息组织10%、必要性10%|主评分，判断选型|','|旧版F/R/S、生成成功/失败、组件注册、实际回传与回执|独立质量参考，不参与新主分|','|耗时、token|继续不计分|','','每项0–5，总分=覆盖×7+操作×5+修改×4+组织×2+必要性×2。A是满足需求的最简DSH原生组合，不是纯文字；J按正常工作的最小充分组件评估，不沿用旧输出的冗余。详细锚点、阈值和假设见[评分规则与边界](评分规则与边界.md)。','','## 直接用于生成选型的建议','','|需求|优先方式|关键判断|','|---|---|---|','|预约、售后、报修的业务整单|json-render DynamicForm|需要预填、集中核对、局部修改、附件关联及一次提交|','|是否确认、是否提交、线上/线下、少量候选中选一项|DSH原生提问|只有一次选择或少量独立信息，无整单编辑要求|','|套餐/地点先概览，再由用户自主看详情|json-render Tabs/Collapsible|用户需要反复分类切换和分层浏览|','|用户直接调换列表顺序并应用|json-render SortableSequence|希望直接操控并试排，不只是要求一个排序答案|','|用户编辑流程步骤、参数和条件分支并保存|json-render Workflow|流程本身是要修改和复用的对象|','|短事实、成功/失败回执、少量固定比较|文字/Markdown|没有必要让用户多作操作|','|一张证据图和是不是同一对象|原生图片+原生确认|图片能看清后一次确认即可|','|静态地图/路线解释|原生地图图片+文字即可|本批C20/N10没有要求自主探索地图|','|需要缩放、探索点位、切换路线的地图|具有对应操作的动态地图|其中点选详情/切换路线等能力仍需确认，不把它们算作本次已验证|','','**预约不是一律弹表单：** 问手续先文字；真正填写和修改完整预约单用json-render；仅问是否提交用原生确认；最终回执用文字。已有表单提供明确提交按钮时，不额外重复弹一个原生确认。','','## 分类结果','','分数按每个需求案例等权平均；每类需求可能包含不同阶段，所以分类均分不是整类统一选型。','', '|大类|案例数|A适配度|J适配度|选型结论|','|---|---:|---:|---:|---|']
for c in categories:report.append(f"|{c['category_id']} {c['title']}|{c['case_count']}|{c['A_mean']:.2f}|{c['J_mean']:.2f}|{category_advice[c['category_id']]}|")
report+=['','本版不以跨全部需求的单一均分排名来宣布某种方式普遍更好：44例含大量无需交互的短答与图像确认，也含明确需要编辑对象的任务。选型应看需求条件和阶段。','',f"本批推荐分布：直接文字 {count['text']} 例、原生图片/提问 {count['native']} 例、优先json-render {count['json_render']} 例、两种接近/按查看方式选择 {count['conditional']} 例。分布反映这份任务集，不代表真实业务占比。",'', '## 代表性重评：交互价值与旧质量分分开看','','|案例|A适配度|J适配度|结论|','|---|---:|---:|---|']
for cid in ['C04-c','C05','C06','C22','N02','N04','N05','N07','N08','N09','N10','N12']:
    r=next(r for r in rows if r['case_id']==cid);report.append(f"|{cid} {r['title']}|{r['scores']['A_native']['weighted_score']}|{r['scores']['J_json_render']['weighted_score']}|{r['recommendation']}|")
report+=['','N07旧版两次实际生成均47分，不改变它作为售后整单更适合动态表单的需求判断；N09旧版保存失败，不改变直接调整顺序的交互价值。它们说明适配度与生成交付可靠性是两个独立问题。反过来，静态N10并不因为旧版Map超时就改选原生；本版选择原生是因为需求本身没有要求地图探索。','','## 44例完整对照','','下表主分只有需求适配度，正分表示J更适配；不足8分按接近处理，优先最小充分方案或用户查看偏好。这个阈值是本版解释约定，不是统计显著性。原始五项分见[逐项评分](44案例_逐项评分.md)和[CSV](评分明细.csv)。','', '|案例|A|J|J−A|建议|需求依据|','|---|---:|---:|---:|---|---|']
for r in rows:report.append(f"|{r['case_id']} {r['title']}|{r['scores']['A_native']['weighted_score']}|{r['scores']['J_json_render']['weighted_score']}|{r['delta_J_minus_A']:+d}|{r['recommendation']}|{r['case_reason']}|")
report+=['','## 阶段规则与适用边界','','[选型规则与阶段示例](选型规则与阶段示例.md)包含10条规则和预约、报修、图片/地图例子。它们是可复用规则文档，尚未发布为Skill。','','复杂不是单纯字段多：同一业务对象的预填、字段关联、跨字段约束、附件核对、局部修改和提交才构成表单价值。三个独立澄清问题可以原生解决；即使只有四项，订单+故障+联系人+照片需要整单核对时也适合动态表单。','','同样，步骤多不自动要求Workflow；只有用户需要直接编辑和复用流程时才值得使用。Tabs适合按需浏览，不自动比并列图片更利于证据对照。状态控制或实时地图是否有真实数据/工具是另一个能力问题，不能由组件外观推定。','','当前44例没有完整覆盖条件显隐、表格交互筛选、地图点位详情/路线切换、多任务实时看板等需求。本版只给出有条件选型规则，扩展例子不计入44例或声称产生了数据。','','## 参考与可复核数据','','- [评分规则与边界](评分规则与边界.md)','- [44例五项评分与理由](44案例_逐项评分.md)','- [评分JSON](评分明细.json)、[评分CSV](评分明细.csv)、[分类汇总](分类汇总.json)','- [原176次运行质量参考](v0.5运行质量参考.md)、[参考JSON](v0.5运行质量参考.json)','- [复评审计](复评说明与审计.json)、[文件哈希](artifact-manifest.json)','','原v0.5报告、分数、原始Session和ZIP均保持不变。本版于2026-11-24按用户明确要求改变评价目标和量表；不能把旧质量分与新适配度分直接相减解释成模型进步。']
md('需求适配度重评报告_v0.6.md',report)
audit={'version':'0.6-suitability','date':'2026-11-24','assessment_kind':'expert_requirement_fit_reassessment','new_model_runs':0,'independent_cases':len(rows),'campus_cases':sum(r['scenario_domain']=='campus_trace_derived' for r in rows),'non_campus_cases':sum(r['scenario_domain']=='non_campus' for r in rows),'fit_ratings':len(rows)*2,'legacy_reference_runs':len(old),'weights':{k:w for k,_,w in dimensions},'recommendation_counts':dict(count),'source_sha256':source_hashes,'unscored_reliability_fields':['generation_failure','registry_errors','timeouts','host_event_delivery','receipt_failure','legacy_F_R_S','tokens','generation_time'],'old_source_files_unchanged':all(hashlib.sha256((OLD/k).read_bytes()).hexdigest()==v for k,v in source_hashes.items())}
assert len(rows)==44 and len(old)==176 and audit['campus_cases']==32 and audit['non_campus_cases']==12
assert sum(w for _,_,w in dimensions)==100
assert all(len(r['v05_reference_run_ids'])==4 for r in rows)
for r in rows:
    for s in r['scores'].values():
        assert all(isinstance(v,int) and 0<=v<=5 for v in s['dimensions'].values())
        assert s['weighted_score']==sum(s['dimensions'][k]*w//5 for k,_,w in dimensions)
assert audit['old_source_files_unchanged']
dump('复评说明与审计.json',audit)
source=Path(__file__);(OUT/'reassess_suitability_v06.py').write_bytes(source.read_bytes())
manifest={'files':[{'path':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(OUT.iterdir()) if p.is_file() and p.name!='artifact-manifest.json']}
dump('artifact-manifest.json',manifest)
broken=[]
for p in OUT.glob('*.md'):
    for link in re.findall(r'\[[^\]]*\]\(([^)]+)\)',p.read_text('utf8')):
        if '://' not in link and not link.startswith('#') and not (OUT/link).exists():broken.append((p.name,link))
assert not broken,broken
archive=BASE/'组件选型_需求适配度重评_v0.6.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:
    for p in sorted(OUT.iterdir()):
        if p.is_file():z.write(p,OUT.name+'/'+p.name)
with zipfile.ZipFile(archive) as z:assert z.testzip() is None
print(json.dumps(audit|{'archive':str(archive),'archive_bytes':archive.stat().st_size,'broken_links':len(broken)},ensure_ascii=False))
