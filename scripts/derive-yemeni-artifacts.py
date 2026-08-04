import csv, json, re, sys, collections
csv.field_size_limit(10**9)
SRC="/mnt/documents/yemeni-corpus/Lisan-Yemeni-dataset.csv"
OUT="docs/yemeni/"
TASH=re.compile(r'[\u064B-\u065F\u0670\u0640]')
AR=re.compile(r'^[\u0621-\u064A]+$')
def norm(s):
    if not s: return ''
    s=TASH.sub('',s).replace('أ','ا').replace('إ','ا').replace('آ','ا').replace('ى','ي').replace('ة','ه')
    return re.sub(r'\s+',' ',s).strip()

CLOSED={'حرف جر','أداة نفي','ضمير','ضمير اشارة','اسم موصول','أداة استفهام','ظرف',
        'أداة ربط','عطف','تعجب','أداة إستثناء','ضمير استفهام','أداة نداء','اسم كم','أداة شرط','أداة جزم','أداة نصب'}
OPEN={'اسم','صفة','صفة مقارنة','فعل مضارع','فعل ماضي','فعل أمر'}
JUNK={'SPELL','SPLIT','اسم علم'}
# Standard MSA closed-class inventory: attested here but NOT dialect markers.
MSA_FUNCTION=set(map(norm,"""من في على الى عن مع بـ ب لـ ل كـ ك حتى منذ خلال بين بعد قبل تحت فوق عند لدى دون سوى غير
ما لا لم لن ليس ليست لست لسنا ليسوا كلا
هو هي هم هن انا انت انتي انتم انتن نحن انا اياه اياها اني انه انها انهم اننا انك
هذا هذه هؤلاء ذلك تلك اولئك هنا هناك هنالك
الذي التي الذين اللاتي اللواتي من ما
كيف لماذا متى اين ماذا هل ايهم اي كم من
و ف ثم او ام بل لكن لكنه اما اذا ان انه لان لكي كي حتى قد لقد سوف
ايضا كذلك ايضاً هكذا جدا جداً فقط الان اليوم امس غدا حيث عندما حينما بينما كما مثل نفس كل بعض جميع
يا ايها الا سوى نعم كلا لو لولا اذن""".split()))
# Shared MSA inflections: و/ف-prefixed variants and preposition+pronoun clitics.
_SUF=['ه','ها','هم','هن','هما','ي','نا','ك','كي','كم','كن']
for _b in ['ل','علي','في','ب','من','مع','عن','الي','لدي','عند','امام','بين','منه']:
    for _s2 in _SUF: MSA_FUNCTION.add(norm(_b+_s2))
MSA_FUNCTION |= {norm('و'+w) for w in list(MSA_FUNCTION)} | {norm('ف'+w) for w in list(MSA_FUNCTION)}

tot=collections.Counter(); zero=collections.Counter()
pos=collections.defaultdict(collections.Counter)
meta={}; pairs=collections.Counter()
rows=0; skipped=0
with open(SRC,encoding='utf-8-sig',newline='') as f:
    for r in csv.DictReader(f):
        rows+=1
        tok=(r.get('Token') or '').strip(); n=norm(tok)
        if not n or not AR.match(n) or len(n)<2: skipped+=1; continue
        p=(r.get('POS') or '').strip()
        try: mid=int((r.get('MSALemmaID') or '0').strip() or 0)
        except ValueError: mid=0
        tot[n]+=1; pos[n][p]+=1
        if mid==0: zero[n]+=1
        m=meta.setdefault(n,{'display':tok,'gloss':'','msa':'','da':''})
        g=(r.get('Gloss') or '').strip()
        if g and not m['gloss']: m['gloss']=g; m['display']=tok
        if not m['msa']: m['msa']=(r.get('MSALemma') or '').strip()
        if not m['da']: m['da']=(r.get('DALemma') or '').strip()
        ms=norm(r.get('MSALemma') or '')
        if mid!=0 and ms and ms!=n and AR.match(ms): pairs[(ms,n)]+=1

def top_pos(n): return pos[n].most_common(1)[0][0]
def entry(n,extra=None):
    m=meta[n]
    e={'token':m['display'],'norm':n,'count':tot[n],'pos':top_pos(n),'gloss':m['gloss'],
       'msa':m['msa'],'da':m['da'],'msa_lemma_zero_ratio':round(zero[n]/tot[n],3)}
    if extra: e.update(extra)
    return e

tokens=[entry(n) for n,_ in tot.most_common() if top_pos(n) not in ('SPELL','SPLIT')][:2000]

# Dialect markers, two evidence classes.
func=[entry(n,{'class':'function_word'}) for n in tot
      if top_pos(n) in CLOSED and tot[n]>=5 and n not in MSA_FUNCTION]
func.sort(key=lambda e:-e['count'])
content=[entry(n,{'class':'content_word'}) for n in tot
         if top_pos(n) in OPEN and top_pos(n) not in JUNK and tot[n]>=3
         and zero[n]/tot[n]>=0.9 and not (pos[n]['اسم علم']/tot[n])>=0.2
         and n not in MSA_FUNCTION]
content.sort(key=lambda e:-e['count'])
dialect_specific=func+content[:1200-len(func)] if len(func)<1200 else func[:1200]

# Drop pairs that differ only by clitics/affixes: those are morphology, not
# MSA->Yemeni lexical substitutions, and they crowd out the useful pairs.
PROCLITIC=['وال','فال','بال','كال','لل','ال','و','ف','ب','ل','ك','س']
ENCLITIC=['ها','هم','هن','هما','ني','نا','كم','كن','ك','ه','ي','ات','ون','ين','ان','وا','ت','ه']
def clitic_variant(msa,yem):
    if yem==msa: return True
    for pre in ['']+PROCLITIC:
        if not yem.startswith(pre): continue
        core=yem[len(pre):]
        for suf in ['']+ENCLITIC:
            if suf and not core.endswith(suf): continue
            stem=core[:len(core)-len(suf)] if suf else core
            if stem==msa: return True
    return False
import difflib
def likely_inflection(a,b):
    # Same stem, different inflection (كان/كنت) is morphology, not a lexical
    # MSA->Yemeni substitution. Flag it so consumers can require review.
    return difflib.SequenceMatcher(None,a,b).ratio()>=0.6
msa_pairs=[{'msa':a,'yemeni':b,'count':c,'likely_inflection':likely_inflection(a,b)}
           for (a,b),c in pairs.most_common() if c>=3 and not clitic_variant(a,b)][:1500]
allow=sorted({e['norm'] for e in dialect_specific} | {t['norm'] for t in tokens})

checks=[]
def chk(name,ok,detail): checks.append({'check':name,'pass':bool(ok),'detail':detail})
chk('no_msa_function_words_in_dialect_specific',
    not [e for e in dialect_specific if e['norm'] in MSA_FUNCTION],
    'stoplist members found: '+str([e['norm'] for e in dialect_specific if e['norm'] in MSA_FUNCTION][:10]))
pn=[e for e in dialect_specific if e['pos']=='اسم علم']
chk('no_proper_nouns_in_dialect_specific', not pn, f'{len(pn)} proper nouns: '+str([e["norm"] for e in pn[:8]]))
cw=[e for e in dialect_specific if e['class']=='content_word' and e['msa_lemma_zero_ratio']<0.9]
chk('content_words_have_no_msa_lemma', not cw, f'{len(cw)} violations')
gen={'من','في','علي','الي','الله','ما','لا','و','هو','هي'}
t10=[e['norm'] for e in dialect_specific[:10]]
chk('top10_not_generic', not (set(t10)&gen), f'top10={t10}')
cwn={e['norm'] for e in dialect_specific if e['class']=='content_word'}
ov=len(cwn & {t['norm'] for t in tokens[:200]})
chk('content_words_low_overlap_with_top200_frequency', ov<=40, f'{ov}/200 overlap')
chk('dialect_specific_size', 300<=len(dialect_specific)<=1200, str(len(dialect_specific)))
chk('function_word_evidence_present', len(func)>=50, f'{len(func)} function words')
chk('msa_pairs_differ', all(p['msa']!=p['yemeni'] for p in msa_pairs), f'{len(msa_pairs)} pairs')
chk('msa_pairs_have_lexical_rows', sum(1 for p in msa_pairs if not p['likely_inflection'])>=300,
    f"{sum(1 for p in msa_pairs if not p['likely_inflection'])} lexical pairs")
chk('msa_pairs_not_clitic_only', not any(clitic_variant(p['msa'],p['yemeni']) for p in msa_pairs),
    f'{sum(1 for p in msa_pairs if clitic_variant(p["msa"],p["yemeni"]))} clitic-only pairs')
chk('tokens_2000', len(tokens)==2000, str(len(tokens)))
chk('all_arabic', all(AR.match(t['norm']) for t in tokens+dialect_specific), 'ok')

stats={'rows_read':rows,'rows_skipped':skipped,'unique_norm_tokens':len(tot),
       'dialect_function_words':len(func),'dialect_content_words':len(dialect_specific)-len(func),
       'msa_pair_types':len(pairs),'allowlist_size':len(allow)}
report={'source':'Lisan-Yemeni annotated corpus','stats':stats,'checks':checks}
print(json.dumps(report,ensure_ascii=False,indent=2))
print('SAMPLE func:',[e['norm'] for e in func[:25]])
print('SAMPLE content:',[e['norm'] for e in content[:25]])

def dump(name,obj): json.dump(obj,open(OUT+name,'w'),ensure_ascii=False,indent=1)
dump('lisan-yemeni-lexicon.json',{'source':report['source'],'description':'Top 2000 normalized tokens by corpus frequency (SPELL/SPLIT rows excluded).','stats':stats,'tokens':tokens})
dump('lisan-yemeni-dialect-specific.json',{'description':'Yemeni dialect markers. class=function_word: closed-class POS, count>=5, not in the MSA closed-class stoplist. class=content_word: open-class POS, count>=3, MSALemmaID==0 in >=90% of occurrences, proper nouns excluded.','stats':stats,'dialect_specific':dialect_specific})
dump('lisan-yemeni-msa-pairs.json',{'description':'MSA lemma -> attested Yemeni surface form (count>=3), clitic-only variants removed. likely_inflection=true means the two forms share a stem (morphology, not a lexical substitution) - prefer likely_inflection=false rows when authoring bridge rules.','count':len(msa_pairs),'pairs':msa_pairs})
dump('lisan-yemeni-allowlist.json',{'description':'Normalized forms attested in Yemeni corpus; use to stop msaLeakDetector flagging real Yemeni forms.','count':len(allow),'allow':allow})
dump('derivation-report.json',report)
sys.exit(0 if all(c['pass'] for c in checks) else 1)
