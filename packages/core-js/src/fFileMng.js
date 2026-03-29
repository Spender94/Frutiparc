/**
 * Runtime JS mirror for Lot A target FFileMng (tree parsing logic).
 */
class FFileMng {
  constructor() {
    this.tree = {};
    this.messages = '';
    this.inbox = '';
    this.blackbox = '';
    this.draftbox = '';
    this.outbox = '';
    this.disccollector = '';
    this.inventory = '';
    this.mycontact = '';
    this.recyclebin = '';
  }

  onLoadTree(success, data) {
    if (!success) return false;

    const bFolder = String(data.lastChild.attributes.b).split(';');
    this.messages = bFolder[0];
    this.inbox = bFolder[1];
    this.outbox = bFolder[2];
    this.blackbox = bFolder[3];
    this.draftbox = bFolder[4];
    this.disccollector = bFolder[5];
    this.inventory = bFolder[6];
    this.mycontact = bFolder[7];
    this.recyclebin = bFolder[8];

    return this.analyseTree(data.lastChild, undefined);
  }

  analyseTree(node, parent) {
    let cur = node;
    while (cur && cur.nodeType > 0) {
      if (cur.nodeName === 'f' || cur.nodeName === 's') {
        if (cur.attributes.u === undefined) cur.attributes.u = 'root';

        this.tree[cur.attributes.u] = {
          name: cur.attributes.n,
          type: cur.attributes.t,
          tpl: cur.attributes.p,
          childs: [],
          parent,
        };

        if (parent !== undefined && cur.nodeName === 'f') {
          this.tree[parent].childs.push(cur.attributes.u);
        }

        if (typeof cur.hasChildNodes === 'function' && cur.hasChildNodes()) {
          this.analyseTree(cur.firstChild, cur.attributes.u);
        }
      }
      cur = cur.nextSibling;
    }
    return true;
  }

  analyseXml(d) {
    const infos = this.tree[d.attributes.u];
    if (infos === undefined) return undefined;

    const l = {
      uid: d.attributes.u,
      type: 'folder',
      desc: [infos.name, infos.type],
      tpl: infos.tpl,
      parent: infos.parent,
      list: [],
    };

    for (let n = d.firstChild; n && n.nodeType > 0; n = n.nextSibling) {
      if (!this.isFileValid(n)) continue;

      if (n.nodeName === 'e') {
        l.list.push({
          uid: n.attributes.u,
          type: n.attributes.t,
          size: n.attributes.s,
          date: n.attributes.d,
          access: n.attributes.a,
          desc: String(n.firstChild.nodeValue).split('\r\n'),
          parent: d.attributes.u,
        });
      } else if (n.nodeName === 'f') {
        l.list.push(this.analyseXml(n));
      }
    }
    return l;
  }

  // eslint-disable-next-line class-methods-use-this
  isFileValid(_node) {
    return true;
  }
}

module.exports = {
  FFileMng,
};
