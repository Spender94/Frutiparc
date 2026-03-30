package frutiparc.core;

/**
 * Portage Haxe du module AS2 FFileMng.
 * Source legacy: frutiengine/FFileMng.as
 */
class FFileMng {
  public var tree:Dynamic;
  public var messages:String = "";
  public var inbox:String = "";
  public var blackbox:String = "";
  public var draftbox:String = "";
  public var outbox:String = "";
  public var disccollector:String = "";
  public var inventory:String = "";
  public var mycontact:String = "";
  public var recyclebin:String = "";

  public function new() {
    this.tree = {};
  }

  public function onLoadTree(success:Bool, data:Dynamic):Bool {
    if (!success) return false;

    var bFolder = Std.string(data.lastChild.attributes.b).split(";");
    this.messages = bFolder[0];
    this.inbox = bFolder[1];
    this.outbox = bFolder[2];
    this.blackbox = bFolder[3];
    this.draftbox = bFolder[4];
    this.disccollector = bFolder[5];
    this.inventory = bFolder[6];
    this.mycontact = bFolder[7];
    this.recyclebin = bFolder[8];

    return this.analyseTree(data.lastChild, null);
  }

  public function analyseTree(node:Dynamic, parent:Dynamic):Bool {
    var cur = node;
    while (cur != null && cur.nodeType > 0) {
      if (cur.nodeName == "f" || cur.nodeName == "s") {
        if (cur.attributes.u == null) cur.attributes.u = "root";

        Reflect.setField(this.tree, cur.attributes.u, {
          name: cur.attributes.n,
          type: cur.attributes.t,
          tpl: cur.attributes.p,
          childs: [],
          parent: parent,
        });

        if (parent != null && cur.nodeName == "f") {
          var p:Dynamic = Reflect.field(this.tree, parent);
          cast(p.childs, Array<Dynamic>).push(cur.attributes.u);
        }

        if (cur.hasChildNodes != null && cur.hasChildNodes()) {
          this.analyseTree(cur.firstChild, cur.attributes.u);
        }
      }
      cur = cur.nextSibling;
    }
    return true;
  }

  public function analyseXml(d:Dynamic):Dynamic {
    var infos:Dynamic = Reflect.field(this.tree, d.attributes.u);
    if (infos == null) return null;

    var l:Dynamic = {
      uid: d.attributes.u,
      type: "folder",
      desc: [infos.name, infos.type],
      tpl: infos.tpl,
      parent: infos.parent,
      list: [],
    };

    var n = d.firstChild;
    while (n != null && n.nodeType > 0) {
      if (this.isFileValid(n)) {
        if (n.nodeName == "e") {
          l.list.push({
            uid: n.attributes.u,
            type: n.attributes.t,
            size: n.attributes.s,
            date: n.attributes.d,
            access: n.attributes.a,
            desc: Std.string(n.firstChild.nodeValue).split("\r\n"),
            parent: d.attributes.u,
          });
        } else if (n.nodeName == "f") {
          l.list.push(analyseXml(n));
        }
      }
      n = n.nextSibling;
    }
    return l;
  }

  public function isFileValid(node:Dynamic):Bool {
    return true;
  }
}
