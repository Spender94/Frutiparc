package frutiparc.core;

import haxe.crypto.Md5;

/**
 * Portage Haxe du module AS2 MD5.
 * Source legacy: frutiengine/MD5.as
 */
class MD5 {
  public static function encode(str:String):String {
    return Md5.encode(str);
  }
}
