// MPL-2.0. Track physical sources independently; last pressed direction wins.
const DIRECTION_MASK=0xF0;
export function createGameInput(onChange){
 const held=new Map();let value=0;
 function publish(){let buttons=0,direction=0;for(const bit of held.values()){const mask=1<<bit;if(mask&DIRECTION_MASK)direction=mask;else buttons|=mask;}const next=buttons|direction;if(next!==value){value=next;onChange(value);}return value;}
 return {get value(){return value;},press(source,bit){if(!Number.isInteger(bit)||bit<0||bit>11||held.has(source))return value;held.set(source,bit);return publish();},release(source){held.delete(source);return publish();},clear(){held.clear();return publish();}};
}
