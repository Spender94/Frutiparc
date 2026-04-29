class listener.dragIconMouse{//}
	static var lastDropTarget;

	// Walk up the parent chain to find a MovieClip with a valid drop handler.
	// In Ruffle, _droptarget can resolve to inner MCs like mcMask that have no
	// dropBox / onDrop — without this fix, drops fall through silently.
	static function resolveDropTarget(mc){
		while(mc != undefined && mc != _level0){
			if(mc.dropBox != undefined) return mc;
			if(typeof(mc.onDrop) == "function") return mc;
			if(mc._parent == undefined) break;
			mc = mc._parent;
		}
		return undefined;
	}

	static function onMouseUp(){
		var raw = eval(_global.dragIcon._droptarget);
		var mc = resolveDropTarget(raw);
		_global.debug("drop: "+_global.dragIcon._droptarget+" -> "+mc+" ("+(mc.dropBox != undefined)+")");
		if(mc == undefined){
			_global.desktop.onDrop(_global.dragIconOrig);
		}else{
			if(mc.dropBox != undefined){
				mc.dropBox.onDrop(_global.dragIconOrig,mc);
			}else{
				mc.onDrop(_global.dragIconOrig);
			}
		}
		_global.deleteDragIcon();
	}

	static function onMouseMove(){
		var raw = eval(_global.dragIcon._droptarget);
		var mc = resolveDropTarget(raw);
		if(mc != lastDropTarget){
			if(lastDropTarget == undefined){
				_global.desktop.onDragRollOut(_global.dragIcon);
			}else{
				if(lastDropTarget.dropBox != undefined){
					lastDropTarget.dropBox.onDragRollOut(_global.dragIcon,lastDropTarget);
				}else{
					lastDropTarget.dropBox.onDragRollOut(_global.dragIcon);
				}
			}
			if(lastDropTarget.myIconGFX != undefined){
				lastDropTarget.myIconGFX.onDragRollOut();
			}
			lastDropTarget = mc;
			if(mc == undefined){
				_global.desktop.onDragRollOver(_global.dragIcon);
			}else{
				if(mc.dropBox != undefined){
					mc.dropBox.onDragRollOver(_global.dragIcon,mc);
				}else{
					mc.dropBox.onDragRollOver(_global.dragIcon);
				}
			}
			if(mc.myIconGFX != undefined){
				mc.myIconGFX.onDragRollOver();
			}
		}
	}
//{
}
