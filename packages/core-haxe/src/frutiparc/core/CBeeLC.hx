package frutiparc.core;

/**
 * Portage Haxe du module AS2 CBeeLC.
 * Source legacy: frutiengine/CBeeLC.as
 */
class CBeeLC {
  public var cbee:CBeeLike;

  public function new(cbee:CBeeLike) {
    this.cbee = cbee;
  }

  public function send(x:Dynamic):Dynamic {
    return this.cbee.send(x);
  }

  public function cmd(a:Dynamic, b:Dynamic, c:Dynamic):Dynamic {
    return this.cbee.cmd(a, b, c);
  }
}

interface CBeeLike {
  public function send(x:Dynamic):Dynamic;
  public function cmd(a:Dynamic, b:Dynamic, c:Dynamic):Dynamic;
}
