#!/usr/bin/env python3
"""Build an offline synthetic preview from the owning notch renderer, with no provider reads."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def preview(destination):
    ui = ROOT / 'desktop/ui'
    html = (ui / 'notch.html').read_text()
    html = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>', '', html)
    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', lambda m: '<style>' + (ui / m[1]).read_text() + '</style>', html)
    html = re.sub(r'<script src="([^"]+)"></script>', lambda m: '<script>' + (ui / m[1]).read_text().replace('</script', '<\\/script') + '</script>', html)
    glyphs = {p: {'kind': 'svg', 'svg': (ui / 'glyphs' / (p + '.svg')).read_text()} for p in ('codex', 'claude', 'gemini')}
    bridge = '''<script>
const syntheticNow=Date.now(), previewListeners={};
const previewAnswers={get_agent_accounts:['codex','claude'].map((base,i)=>({id:base,base,name:base==='codex'?'Codex (synthetic)':'Claude (synthetic)',glyph:base==='codex'?'Cx':'C',snap:{status:'ok',windows:[{id:base==='codex'?'primary':'session',label:'5 hours',used:i?.55:.23,resets_at:syntheticNow+7200000}],fetched_at:syntheticNow,details:[],note:''}})),
get_glyphs:GLYPHS,get_ui_flags:{notch_visible:false,notch_on_hover:true},get_notch_edge:'top',get_state:{sessions:[],agg:'idle',counts:{},lang_resolved:'en'},get_notch_slots:[],get_activity:[],get_notch_buttons:{pin:true,alerts:true},get_alert_log:[],get_update_state:{status:'current'},get_theme_resolved:'dark'};
window.agentUsage={invoke:(name)=>Promise.resolve(previewAnswers[name]??null),on:(name,cb)=>{(previewListeners[name]??=[]).push(cb);return ()=>{};}};
window.__emit=(name,value)=>(previewListeners[name]||[]).forEach(cb=>cb(value));
</script>'''.replace('GLYPHS', json.dumps(glyphs))
    html = html.replace('<head>', '<head>' + bridge)
    controls = '''<style>html{background:#97aabe}#preview-controls{position:fixed;bottom:18px;left:16px;right:16px;z-index:100;color:#17212d;font:14px system-ui}#preview-controls button,#preview-controls select{font:inherit;margin:4px;padding:8px;border:1px solid #617387;border-radius:8px;background:#e3ebf2;color:#17212d}</style>
<div id="preview-controls">Synthetic quota data · shared desktop renderer<br>
<button onclick="__emit('appear')">Reveal</button><button onclick="__emit('disappear')">Hide</button>
<button onclick="__emit('disappear');setTimeout(()=>__emit('appear'),350)">Reverse at 350 ms</button>
<select aria-label="Placement" onchange="previewPlace(this.value)"><option>top</option><option>right</option><option>bottom</option><option>left</option></select>
</div><script>window.previewPlace=edge=>{__emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge,along:.5,visible:true,tracking:false,pinned:false});__emit('appear',{edge});};setTimeout(()=>previewPlace('top'),150);</script>'''
    html = html.replace('</body>', controls + '</body>')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(html)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    preview(parser.parse_args().destination)
