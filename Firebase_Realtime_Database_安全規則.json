{
  "rules": {
    ".read": false,
    ".write": false,

    "staff": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && root.child('staff').child(auth.uid).child('role').val() === 'admin'",
        ".validate": "newData.hasChildren(['role','email'])"
      }
    },

    "onlineOrders": {
      ".indexOn": ["createdAt", "status", "customerPhone"],

      "$orderId": {
        ".read": "auth != null && ((root.child('staff').child(auth.uid).child('role').val() === 'staff') || (root.child('staff').child(auth.uid).child('role').val() === 'admin') || (data.child('customerUid').val() === auth.uid))",
        ".write": "auth != null && ((!data.exists() && newData.child('customerUid').val() === auth.uid) || (data.exists() && ((root.child('staff').child(auth.uid).child('role').val() === 'staff') || (root.child('staff').child(auth.uid).child('role').val() === 'admin'))))",
        ".validate": "newData.hasChildren(['orderNo','customerUid','customerName','customerPhone','orderType','items','subtotal','total','status','createdAt','updatedAt'])",

        "orderNo": { ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 40" },
        "customerUid": { ".validate": "newData.isString() && newData.val() === auth.uid" },
        "customerName": { ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 40" },
        "customerPhone": { ".validate": "newData.isString() && newData.val().length >= 6 && newData.val().length <= 20" },
        "customerNote": { ".validate": "!newData.exists() || (newData.isString() && newData.val().length <= 200)" },
        "orderType": { ".validate": "newData.val() === '線上點餐-內用' || newData.val() === '線上點餐-外帶'" },
        "subtotal": { ".validate": "newData.isNumber() && newData.val() >= 0" },
        "total": { ".validate": "newData.isNumber() && newData.val() >= 0" },
        "status": { ".validate": "newData.val() === 'pending_confirm' || newData.val() === 'confirmed' || newData.val() === 'rejected'" },
        "prepTimeMinutes": { ".validate": "!newData.exists() || (newData.isNumber() && newData.val() >= 1 && newData.val() <= 240)" },
        "estimatedReadyAt": { ".validate": "!newData.exists() || newData.isString()" },
        "replyMessage": { ".validate": "!newData.exists() || (newData.isString() && newData.val().length <= 120)" },
        "createdAt": { ".validate": "newData.isString()" },
        "updatedAt": { ".validate": "newData.isString()" },
        "items": {
          ".validate": "newData.hasChildren()",
          "$itemId": {
            ".validate": "newData.hasChildren(['productId','name','basePrice','qty','extraPrice']) && newData.child('name').isString() && newData.child('basePrice').isNumber() && newData.child('qty').isNumber() && newData.child('qty').val() > 0 && newData.child('extraPrice').isNumber()"
          }
        }
      }
    }
  }
}
