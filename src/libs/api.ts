/**************************************************************************************************
    File Name	: api.ts
    Description
      API Module

    Update History
      2022.06            BGKim       Create
**************************************************************************************************/

///////////////////////////////////////////////////////////////////////////////////////////////////
//                                  Import Modules                                               //
///////////////////////////////////////////////////////////////////////////////////////////////////
import define from "./define";
import config from "./config";
import error  from "./error";
import auth   from "./auth.js";
import assert from "assert";
import _ from "lodash";
import { Request, Response, Application, RequestHandler } from 'express';
import {
    API, ApiHandler, ApiHandlers,
    UserInfo, GuestApiParams, UserApiParams
} from "@appTypes";


///////////////////////////////////////////////////////////////////////////////////////////////////
//                                  Class Implementation                                         //
///////////////////////////////////////////////////////////////////////////////////////////////////
class BGAPI
{
    private app: Application | null = null;

    guest: ApiHandlers;
    admin: ApiHandlers;

    get: ApiHandler;
    post: ApiHandler;
    put: ApiHandler;
    delete: ApiHandler;

    constructor() {
        this.guest = this._createAPIHandlers(define.authLevel.guest);
        this.admin = this._createAPIHandlers(define.authLevel.admin);

        // default member auth api
        const memberApiHandlers = this._createAPIHandlers(define.authLevel.member);

        this.get = memberApiHandlers.get;
        this.post = memberApiHandlers.post;
        this.put = memberApiHandlers.put;
        this.delete = memberApiHandlers.delete;
    }

    init(app: Application) {
        this.app = app;
    }

    private _createAPIHandlers(authLevel: string): ApiHandlers {
        const _this = this;
        return {
            get: async function(path: string, fnExecute: Function) {
                _this._get(path, fnExecute, authLevel);
            },
            post: async function(path: string, fnExecute: Function) {
                _this._post(path, fnExecute, authLevel);
            },
            put: async function(path: string, fnExecute: Function) {
                _this._put(path, fnExecute, authLevel);
            },
            delete: async function(path: string, fnExecute: Function) {
                _this._delete(path, fnExecute, authLevel);
            },
        };
    }

    private _get(
        path: string,
        fnExecute: Function,
        authLevel: string
    ) {
        this.app!.get(path, async (request, response) => {
            await _defaultProc(request, response, fnExecute, authLevel);
        });
    }

    private _post(
        path: string,
        fnExecute: Function,
        authLevel: string = define.authLevel.member
    ) {
        this.app!.post(path, async (request, response) => {
            await _defaultProc(request, response, fnExecute, authLevel);
        });
    }

    private _put(
        path: string,
        fnExecute: Function,
        authLevel: string = define.authLevel.member
    ) {
        this.app!.put(path, async (request, response) => {
            await _defaultProc(request, response, fnExecute, authLevel);
        });
    }

    private _delete(
        path: string,
        fnExecute: Function,
        authLevel: string = define.authLevel.member
    ) {
        this.app!.delete(path, async (request, response) => {
            await _defaultProc(request, response, fnExecute, authLevel);
        });
    }
}



///////////////////////////////////////////////////////////////////////////////////////////////////
//                                  Private Functions                                            //
///////////////////////////////////////////////////////////////////////////////////////////////////
function getUserIp(request: Request) {
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded !== undefined) {
        if (typeof forwarded === 'string') {
            return forwarded.split(/, /)[0];
        } else /* string[] */ {
            return forwarded[0] || '';
        }
    } else {
        return request.socket.remoteAddress || '';
    }
}



function responseMessage(response : Response, jsonMessage : any) {
    "use strict";
    response.writeHead( error.responseCodes.RESPONSE_CODE_OK, {"Content-Type" : "application/json"} );
    if( jsonMessage === undefined || jsonMessage === null )
        return response.end("{}");

    const jsonResponse : any = {};
    if (jsonMessage.constructor === Array) {
        jsonResponse[config.responseTopLevelDataName] = {items: jsonMessage};
    } else {
        jsonResponse[config.responseTopLevelDataName] = {item: jsonMessage};
    }

    response.end( JSON.stringify(jsonResponse) );
}

// ?????? ?????? ?????? ????????? ???????????? ?????? ??????????????? ?????? ?????????, ?????? undefined ???????????? ???????????? ???????????? ?????? ???????????????.
// ????????? ????????? ??? ?????? ???????????? ??????????????? ?????? ???????????? ????????? ????????? ????????? ???????????? ???????????? ???????????? ????????????.
function sendErrorMessage(
    response: Response,
    nResponseCode: number,
    nErrorCode: number,
    strMessage: string,
    strDetailMessage?: string
) {
  "use strict";
  const strMessageBuffer = (strMessage) ?  strMessage : error.getErrorString(nErrorCode) ;
  response.writeHead( nResponseCode, {"Content-Type" : "application/json"} );

  const jsonResult = 	{
    code : nErrorCode,
    msg : strMessageBuffer,
    detailMessage : strDetailMessage
  };
  response.end( JSON.stringify( jsonResult ) );
}



function defaultErrorProcess( response: Response, e: any ) {
  "use strict";
  assert( e !== undefined );
  if( e instanceof error.AppError ) {
    if( e.httpResponseCode !== error.responseCodes.RESPONSE_CODE_INTERNAL_SERVER_ERROR  ) {
      sendErrorMessage( response, e.httpResponseCode,  e.code, e.message, e.detailMessage );
      return ;
    }
  }

  // ?????? ?????? ???????????? ?????????????????? ????????? ????????? ???????????? ?????????.
  sendErrorMessage(
    response,
    error.responseCodes.RESPONSE_CODE_INTERNAL_SERVER_ERROR,
    error.errorCodes.ERROR_CODE_INTERNAL_SERVER_ERROR,
    error.getErrorString( error.errorCodes.ERROR_CODE_INTERNAL_SERVER_ERROR )
  );
}

function getUserInfoIfExist( request : Request ) {
    let jsonUserIp = { ip : getUserIp(request) };
    const strSecurityToken = request.header("Authorization");
    if( !strSecurityToken )
        return jsonUserIp;

    const userInfo = auth.getUserInfoWithSecurityToken( strSecurityToken );
    return _.defaultsDeep(userInfo, jsonUserIp);
}

function getUserInfoAndRejectNotMember( request : Request ) {
    const userInfo = getUserInfoIfExist(request);
    const keyCount  = Object.keys(userInfo).length;
    if( keyCount === 1) { // only include user ip information
        throw error.newInstanceNotMemberError();
    }
    return userInfo;
}

function getUserInfoAndRejectNotAdmin( request: Request ) {
    const userInfo = getUserInfoIfExist(request);

    const keyCount  = Object.keys(userInfo).length;
    if( keyCount === 1) { // only include user ip information
        throw error.newInstanceNotMemberError();
    }


    if( userInfo.type !== define.userType.admin )
        throw error.newInstanceForbiddenError("Not admin");

    return userInfo;
}


function getExecuteParamsWithRequest(
    request: Request,
    userInfo: UserInfo | null
): GuestApiParams<any> | UserApiParams<any> {
    return {
        params : request.params,
        query : request.query,
        body : request.body,
        useragent : request.headers['user-agent'],
        cookies : request.cookies,
        userInfo
    };
}



async function _defaultProc(
    request: Request,
    response: Response,
    fnExecute: Function,
    strAuthLevel: string
){
  "use strict";
  let userInfo = null;
  try {
    switch(strAuthLevel) {
      case define.authLevel.guest:
        userInfo =  getUserInfoIfExist(request);
        break;
      case define.authLevel.member:
        userInfo =  getUserInfoAndRejectNotMember(request);
        break;
    case define.authLevel.admin:
        userInfo = getUserInfoAndRejectNotAdmin(request);
        break;
      default:
        assert(false);
        break;
    }


    const params = getExecuteParamsWithRequest(request, userInfo);

    let result = await fnExecute(params);
    if( result && result.cookie ) {
      assert( result.cookie.name );
      assert( result.cookie.value );
      response.cookie(result.cookie.name, result.cookie.value, result.cookie.options);
      delete result.cookie;
    }

    return responseMessage( response, result );
  } catch(err) {
      console.log(err);
    return defaultErrorProcess( response, err );
  }
}


///////////////////////////////////////////////////////////////////////////////////////////////////
//                                  Export  Modules                                              //
///////////////////////////////////////////////////////////////////////////////////////////////////
const api = new BGAPI();
export {
    api,
    defaultErrorProcess,
    getUserInfoAndRejectNotMember
};
